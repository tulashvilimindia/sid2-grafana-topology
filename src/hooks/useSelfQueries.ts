import { useEffect, useMemo, useRef, useState } from 'react';
import { DataFrame } from '@grafana/data';
import { TopologyNode, TopologyEdge, DatasourceQueryConfig } from '../types';
import { queryDatasource, QueryResult, QueryError } from '../utils/datasourceQuery';

// ─── Auto-fetch: query datasources for metrics not covered by panel queries ───
interface UncoveredMetric {
  metricId: string;
  dsUid: string;
  query: string;
  queryConfig?: DatasourceQueryConfig;
}

/**
 * Fetches metric values directly from datasources for any node or edge
 * metric not already covered by the panel's own query data frames. The
 * result is debounced by 500ms so rapid option edits don't fan out a
 * flurry of fetches.
 */
export function useSelfQueries(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  panelSeries: DataFrame[],
  replaceVars?: (value: string) => string,
  historicalTime?: number
): { data: Map<string, QueryResult>; isLoading: boolean; failures: Map<string, QueryError> } {
  const [results, setResults] = useState<Map<string, QueryResult>>(new Map());
  const [failures, setFailures] = useState<Map<string, QueryError>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collect node + edge metrics that need self-querying.
  // A metric is "fetchable" if it has a datasourceUid AND at least one query
  // primitive: PromQL in `query`, OR CloudWatch namespace+metricName, OR Infinity url.
  const uncoveredMetrics = useMemo(() => {
    const covered = new Set(panelSeries.map((f) => f.refId).filter(Boolean));
    const uncovered: UncoveredMetric[] = [];

    const hasQueryPrimitive = (query: string, cfg?: DatasourceQueryConfig): boolean => {
      if (query) { return true; }
      if (cfg?.namespace && cfg?.metricName) { return true; }
      if (cfg?.url) { return true; }
      return false;
    };

    // Node metrics
    nodes.forEach((node) => {
      node.metrics.forEach((m) => {
        if (m.datasourceUid && hasQueryPrimitive(m.query, m.queryConfig) && !covered.has(m.id)) {
          uncovered.push({
            metricId: m.id,
            dsUid: m.datasourceUid,
            query: m.query,
            queryConfig: m.queryConfig,
          });
        }
      });
    });

    // Edge metrics
    edges.forEach((edge) => {
      if (edge.metric?.datasourceUid
          && hasQueryPrimitive(edge.metric.query, edge.metric.queryConfig)
          && !covered.has(edge.id)) {
        uncovered.push({
          metricId: edge.id,
          dsUid: edge.metric.datasourceUid,
          query: edge.metric.query,
          queryConfig: edge.metric.queryConfig,
        });
      }
    });

    return uncovered;
  }, [nodes, edges, panelSeries]);

  // Track whether results exist via ref to avoid adding results to deps (which causes infinite loop)
  const hasResultsRef = useRef(false);
  hasResultsRef.current = results.size > 0;

  useEffect(() => {
    if (uncoveredMetrics.length === 0) {
      if (hasResultsRef.current) {
        setResults(new Map());
        setFailures(new Map());
      }
      return;
    }

    if (fetchTimerRef.current) {
      clearTimeout(fetchTimerRef.current);
    }

    // AbortController + cancelled guard: on unmount or dep change, cancel
    // in-flight fetches AND prevent state updates after they resolve.
    // Mirrors the pattern used by useAlertRules / useDynamicTargets.
    const controller = new AbortController();
    let cancelled = false;

    fetchTimerRef.current = setTimeout(async () => {
      if (cancelled) { return; }
      setIsLoading(true);
      const newResults = new Map<string, QueryResult>();
      const newFailures = new Map<string, QueryError>();

      // Query all uncovered metrics using the multi-DS abstraction
      // (queryDatasource auto-detects the datasource type from the UID)
      const promises = uncoveredMetrics.map(async (m) => {
        const result = await queryDatasource(
          m.dsUid, m.query, undefined, m.queryConfig, replaceVars, historicalTime, controller.signal
        );
        newResults.set(m.metricId, result);
        if (result.error) {
          newFailures.set(m.metricId, result.error);
        }
      });

      await Promise.all(promises);
      if (cancelled) { return; }
      setResults(newResults);
      setFailures(newFailures);
      setIsLoading(false);
    }, 500);

    return () => {
      cancelled = true;
      controller.abort();
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
      }
    };
  }, [uncoveredMetrics, replaceVars, historicalTime]);

  return { data: results, isLoading, failures };
}
