/**
 * dynamicTargets.ts — Resolve DynamicTargetQuery edges to concrete target lists
 *
 * Pure utility: no React, no state, no side effects beyond fetch.
 *
 * Used by useDynamicTargets in TopologyPanel to expand a single edge with a
 * `targetQuery` field into N virtual edges, one per distinct label value the
 * query returns. This lets users declare "edge from pool → each live member"
 * without hand-listing every member in the topology config.
 *
 * 3.1a: Prometheus-only via resolvePrometheusTargets.
 * 3.1b: Adds CloudWatch and Infinity via resolveCloudWatchTargets and
 *       resolveInfinityTargets, routed via detectDatasourceType.
 *
 * Never throws EXCEPT on AbortError (rethrown so callers can distinguish
 * intentional cleanup from real failures).
 */

import { TopologyEdge, DatasourceQueryConfig } from '../types';
import { detectDatasourceType } from './datasourceQuery';

/**
 * Run a PromQL query and extract distinct values of a given label from the
 * results. Used for pool-member-style discovery:
 *   query: `up{job="myapp"}`
 *   nodeIdLabel: `instance`
 *   → returns the list of instances currently reporting via the `up` metric.
 */
export async function resolvePrometheusTargets(
  dsUid: string,
  promQlQuery: string,
  nodeIdLabel: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (!dsUid || !promQlQuery || !nodeIdLabel) {
    return [];
  }
  try {
    const resp = await fetch(
      `/api/datasources/proxy/uid/${dsUid}/api/v1/query?query=${encodeURIComponent(promQlQuery)}`,
      signal ? { signal } : undefined
    );
    if (!resp.ok) {
      console.warn('[topology] dynamic target resolve http error', { dsUid, status: resp.status });
      return [];
    }
    const data = await resp.json();
    const results = data?.data?.result;
    if (!Array.isArray(results)) {
      return [];
    }
    const seen = new Set<string>();
    for (const row of results) {
      const value = row?.metric?.[nodeIdLabel];
      if (typeof value === 'string' && value) {
        seen.add(value);
      }
    }
    return Array.from(seen);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw err;
    }
    console.warn('[topology] dynamic target resolve network error', { dsUid, err });
    return [];
  }
}

/**
 * Resolve CloudWatch discovery targets. Runs the standard CloudWatch metric query
 * (namespace + metricName + optional filter dimensions) and parses each returned
 * frame's schema.name for the `nodeIdLabel=value` substring. Returns unique values.
 *
 * The expected response shape is one frame per unique combination of the remaining
 * dimensions — this is what CloudWatch returns when you leave `nodeIdLabel` out of
 * the dimension filter list. Frame names like `RequestCount {LoadBalancer=app/abc}`
 * are parsed via a regex keyed on `nodeIdLabel`.
 */
export async function resolveCloudWatchTargets(
  dsUid: string,
  config: DatasourceQueryConfig,
  nodeIdLabel: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (!config.namespace || !config.metricName || !nodeIdLabel) {
    return [];
  }
  try {
    // Build dimension filters but OMIT the discovery dimension — we want CloudWatch
    // to return one frame per unique value of nodeIdLabel.
    const dimensions: Record<string, string[]> = {};
    if (config.dimensions) {
      for (const [key, val] of Object.entries(config.dimensions)) {
        if (key !== nodeIdLabel) {
          dimensions[key] = [val];
        }
      }
    }

    const resp = await fetch('/api/ds/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: [{
          refId: 'A',
          datasource: { uid: dsUid, type: 'cloudwatch' },
          type: 'timeSeriesQuery',
          namespace: config.namespace,
          metricName: config.metricName,
          dimensions,
          statistic: config.stat || 'Average',
          period: String(config.period || 300),
          region: 'default',
        }],
        from: 'now-15m',
        to: 'now',
      }),
      signal,
    });
    if (!resp.ok) {
      console.warn('[topology] cloudwatch discovery http error', { dsUid, status: resp.status });
      return [];
    }
    const data = await resp.json();
    const frames = data?.results?.A?.frames || [];
    const seen = new Set<string>();
    // Regex captures `nodeIdLabel=<value>` from the frame name — stops at comma or closing brace
    const regex = new RegExp(`\\b${nodeIdLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^,}]+)`);
    for (const frame of frames) {
      const name = frame?.schema?.name || '';
      const match = name.match(regex);
      if (match && match[1]) {
        seen.add(match[1].trim());
      }
    }
    return Array.from(seen);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw err;
    }
    console.warn('[topology] cloudwatch discovery network error', { dsUid, err });
    return [];
  }
}

/**
 * Resolve Infinity discovery targets. Runs a JSON/URL query and extracts the
 * first column's values. The user configures the URL + rootSelector so the
 * response is an array of objects, and the `nodeIdLabel` is the column selector
 * that returns the target identifier for each row.
 */
export async function resolveInfinityTargets(
  dsUid: string,
  config: DatasourceQueryConfig,
  nodeIdLabel: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (!config.url || !nodeIdLabel) {
    return [];
  }
  try {
    const urlOptions: Record<string, string> = {
      method: config.method || 'GET',
    };
    if (config.body) {
      urlOptions.body_type = 'raw';
      urlOptions.body_content_type = 'application/json';
      urlOptions.data = config.body;
    }

    const resp = await fetch('/api/ds/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: [{
          refId: 'A',
          datasource: { uid: dsUid, type: 'yesoreyeram-infinity-datasource' },
          type: 'json',
          parser: 'backend',
          source: 'url',
          url: config.url,
          root_selector: config.rootSelector || '',
          url_options: urlOptions,
          // For discovery, request a single string column keyed on nodeIdLabel
          columns: [{ selector: nodeIdLabel, text: nodeIdLabel, type: 'string' }],
        }],
        from: 'now-15m',
        to: 'now',
      }),
      signal,
    });
    if (!resp.ok) {
      console.warn('[topology] infinity discovery http error', { dsUid, status: resp.status });
      return [];
    }
    const data = await resp.json();
    const frames = data?.results?.A?.frames || [];
    const seen = new Set<string>();
    for (const frame of frames) {
      const values = frame?.data?.values?.[0] || [];
      for (const v of values) {
        if (typeof v === 'string' && v) {
          seen.add(v);
        } else if (typeof v === 'number') {
          seen.add(String(v));
        }
      }
    }
    return Array.from(seen);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw err;
    }
    console.warn('[topology] infinity discovery network error', { dsUid, err });
    return [];
  }
}

/**
 * Resolve every edge with a `targetQuery` to its list of discovered target values.
 * Returns a map of parent-edge-id → array of target values.
 *
 * Routes by datasource type via detectDatasourceType:
 *   - prometheus → resolvePrometheusTargets (uses tq.query)
 *   - cloudwatch → resolveCloudWatchTargets (uses tq.queryConfig)
 *   - yesoreyeram-infinity-datasource → resolveInfinityTargets (uses tq.queryConfig)
 *   - anything else → falls back to Prometheus resolver (graceful degradation)
 */
export async function resolveDynamicTargets(
  edges: TopologyEdge[],
  signal?: AbortSignal
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  // An edge is "dynamic-ready" if it has a datasource + nodeIdLabel + at least one query primitive
  const dynamicEdges = edges.filter((e) => {
    if (!e.targetQuery || !e.targetQuery.datasourceUid || !e.targetQuery.nodeIdLabel) {
      return false;
    }
    const tq = e.targetQuery;
    // Prometheus uses tq.query; CloudWatch/Infinity use tq.queryConfig
    return !!tq.query || !!(tq.queryConfig && (tq.queryConfig.namespace || tq.queryConfig.url));
  });
  if (dynamicEdges.length === 0) {
    return result;
  }

  await Promise.all(
    dynamicEdges.map(async (edge) => {
      const tq = edge.targetQuery!;
      const type = detectDatasourceType(tq.datasourceUid);
      let values: string[] = [];
      switch (type) {
        case 'prometheus':
          values = await resolvePrometheusTargets(tq.datasourceUid, tq.query, tq.nodeIdLabel, signal);
          break;
        case 'cloudwatch':
          if (tq.queryConfig) {
            values = await resolveCloudWatchTargets(tq.datasourceUid, tq.queryConfig, tq.nodeIdLabel, signal);
          }
          break;
        case 'yesoreyeram-infinity-datasource':
          if (tq.queryConfig) {
            values = await resolveInfinityTargets(tq.datasourceUid, tq.queryConfig, tq.nodeIdLabel, signal);
          }
          break;
        default:
          // Unknown type — try Prometheus as graceful fallback
          values = await resolvePrometheusTargets(tq.datasourceUid, tq.query, tq.nodeIdLabel, signal);
      }
      result.set(edge.id, values);
    })
  );
  return result;
}
