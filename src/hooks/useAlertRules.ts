import { useEffect, useMemo, useRef, useState } from 'react';
import { TopologyNode, FiringAlert } from '../types';
import { fetchAlertRules, matchAlertsToNode } from '../utils/alertRules';

/**
 * Polls Grafana's unified alerting API at a configurable interval and
 * returns a map of node id → firing alerts matched via node.alertLabelMatchers.
 * Only nodes that actually opt in (non-empty alertLabelMatchers) trigger
 * polling — otherwise the hook is a no-op.
 *
 * The poll interval is clamped to a 5000ms hard floor so a user typo
 * cannot hammer the alerting API at 20Hz.
 */
export function useAlertRules(nodes: TopologyNode[], pollIntervalMs: number): Map<string, FiringAlert[]> {
  const [alertsByNode, setAlertsByNode] = useState<Map<string, FiringAlert[]>>(new Map());

  // Only nodes opted-in via alertLabelMatchers trigger polling
  const nodesWithMatchers = useMemo(
    () => nodes.filter((n) => n.alertLabelMatchers && Object.keys(n.alertLabelMatchers).length > 0),
    [nodes]
  );

  // Avoid adding alertsByNode to deps (would cause infinite loop)
  const hasAlertsRef = useRef(false);
  hasAlertsRef.current = alertsByNode.size > 0;

  useEffect(() => {
    if (nodesWithMatchers.length === 0) {
      if (hasAlertsRef.current) {
        setAlertsByNode(new Map());
      }
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      try {
        const result = await fetchAlertRules(controller.signal);
        if (cancelled) {
          return;
        }
        const next = new Map<string, FiringAlert[]>();
        nodesWithMatchers.forEach((n) => {
          const matched = matchAlertsToNode(result.alerts, n.alertLabelMatchers);
          if (matched.length > 0) {
            next.set(n.id, matched);
          }
        });
        setAlertsByNode(next);
      } catch (err) {
        // AbortError is intentional cleanup — swallow silently
        if ((err as Error).name !== 'AbortError') {
          console.warn('[topology] useAlertRules run failed', err);
        }
      }
    };

    run();
    // Clamp to a sane minimum so a user typo like "50" doesn't hammer the
    // Grafana alerting API at 20Hz. 5000ms is a hard floor.
    const effectiveInterval = Math.max(pollIntervalMs, 5000);
    const interval = setInterval(run, effectiveInterval);

    return () => {
      cancelled = true;
      clearInterval(interval);
      controller.abort();
    };
  }, [nodesWithMatchers, pollIntervalMs]);

  return alertsByNode;
}
