/**
 * alertRules.ts — Grafana unified alerting integration
 *
 * Pure utility: no React, no state, no side effects beyond fetch.
 * Polls Grafana's Prometheus-compatible rules API and matches firing/pending
 * alerts to topology nodes by label set.
 *
 * Never throws (except on AbortError, which callers handle).
 */

import { FiringAlert } from '../types';

// ─── Response shape (subset we actually read) ───

interface GrafanaRuleAlert {
  state: string;
  labels: Record<string, string>;
  activeAt?: string;
  annotations?: Record<string, string>;
}

interface GrafanaRule {
  name: string;
  state: string;
  alerts?: GrafanaRuleAlert[];
  annotations?: Record<string, string>;
  /** Grafana unified alerting rule UID — not guaranteed on all Grafana versions */
  uid?: string;
}

interface GrafanaRuleGroup {
  name: string;
  rules: GrafanaRule[];
}

interface GrafanaRulesResponse {
  status: string;
  data?: { groups: GrafanaRuleGroup[] };
}

/** Possible fetch error categories */
export type AlertFetchError = 'network' | 'http' | 'parse';

/** Result of a fetchAlertRules call */
export interface AlertRulesResult {
  alerts: FiringAlert[];
  fetchedAt: number;
  error?: AlertFetchError;
}

/**
 * Fetch all firing/pending alerts from Grafana's unified alerting endpoint.
 * Uses the user's session auth — no token required.
 *
 * Never throws EXCEPT on AbortError (rethrown so callers can distinguish
 * intentional cleanup from real failures).
 *
 * @param signal — optional AbortSignal for cancellation on unmount/deps change
 */
export async function fetchAlertRules(signal?: AbortSignal): Promise<AlertRulesResult> {
  const fetchedAt = Date.now();
  try {
    const resp = await fetch('/api/prometheus/grafana/api/v1/rules', signal ? { signal } : undefined);
    if (!resp.ok) {
      console.warn('[topology] alert rules fetch http error', { status: resp.status });
      return { alerts: [], fetchedAt, error: 'http' };
    }
    const data = (await resp.json()) as GrafanaRulesResponse;
    if (data?.status !== 'success' || !data.data?.groups) {
      console.warn('[topology] alert rules fetch parse error', { status: data?.status });
      return { alerts: [], fetchedAt, error: 'parse' };
    }

    const alerts: FiringAlert[] = [];
    for (const group of data.data.groups) {
      if (!group.rules) {
        continue;
      }
      for (const rule of group.rules) {
        if (!rule.alerts) {
          continue;
        }
        for (const instance of rule.alerts) {
          if (instance.state === 'firing' || instance.state === 'pending') {
            // Merge annotations: instance-level overrides rule-level (mirrors Grafana's own semantics)
            const mergedAnnotations = { ...(rule.annotations || {}), ...(instance.annotations || {}) };
            const alert: FiringAlert = {
              ruleName: rule.name,
              state: instance.state,
              labels: instance.labels || {},
              activeAt: instance.activeAt,
            };
            if (Object.keys(mergedAnnotations).length > 0) {
              alert.annotations = mergedAnnotations;
            }
            if (rule.uid) {
              alert.ruleUid = rule.uid;
            }
            alerts.push(alert);
          }
        }
      }
    }

    return { alerts, fetchedAt };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw err;
    }
    console.warn('[topology] alert rules fetch network error', err);
    return { alerts: [], fetchedAt, error: 'network' };
  }
}

/**
 * Match a set of alerts to a node's label matchers.
 * Returns the subset of alerts whose labels contain every key/value pair in `matchers`.
 * Empty or missing matchers → empty result (opt-in only).
 */
export function matchAlertsToNode(
  alerts: FiringAlert[],
  matchers: Record<string, string> | undefined
): FiringAlert[] {
  if (!matchers || Object.keys(matchers).length === 0) {
    return [];
  }
  return alerts.filter((a) => {
    for (const [key, val] of Object.entries(matchers)) {
      if (a.labels[key] !== val) {
        return false;
      }
    }
    return true;
  });
}
