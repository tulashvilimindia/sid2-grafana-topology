/**
 * datasourceQuery.ts — Datasource-agnostic query abstraction
 *
 * Pure utility: no React, no state, no side effects beyond fetch.
 * Supports Prometheus, CloudWatch, and Infinity (NR/Kibana/CF) datasources.
 * Always returns number | null, never throws.
 */

import { getDataSourceSrv } from '@grafana/runtime';
import { DatasourceQueryConfig } from '../types';

/** Categorised error codes for failed queries. Empty results are NOT errors. */
export type QueryError = 'network' | 'http' | 'parse';

/** Result of a single metric query — value null + error set means fetch failed */
export interface QueryResult {
  value: number | null;
  error?: QueryError;
  /** Unix ms timestamp when the fetch resolved. Used for freshness indicators. */
  fetchedAt?: number;
}

/** One sample of a time series — used by the NodePopup sparkline */
export interface TimeseriesPoint {
  timestamp: number;
  value: number;
}

/**
 * Detect datasource type by UID using Grafana's DataSourceSrv.
 * Returns the type string (e.g. 'prometheus', 'cloudwatch', 'yesoreyeram-infinity-datasource')
 * or 'unknown' if not found.
 */
export function detectDatasourceType(dsUid: string): string {
  try {
    const settings = getDataSourceSrv().getInstanceSettings(dsUid);
    return settings?.type || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Query a datasource and return a single numeric value.
 * Routes to the correct API based on datasource type.
 *
 * @param dsUid - Datasource UID
 * @param query - Query expression (PromQL for Prometheus, metric name for CloudWatch)
 * @param dsType - Optional type hint (auto-detected if not provided)
 * @param queryConfig - Optional config for CloudWatch/Infinity queries
 * @param replaceVars - Optional template variable interpolation function
 * @param historicalTime - Optional Unix timestamp for time travel queries
 */
/** Hard ceiling for any single query when no external signal is provided. */
const QUERY_TIMEOUT_MS = 10_000;

/**
 * Deep-interpolate all string fields of a DatasourceQueryConfig through
 * Grafana's replaceVariables function. Returns a NEW object — never
 * mutates the input. When `replaceVars` is undefined or `config` is
 * undefined, returns the input by reference as a fast path.
 *
 * Fields interpolated:
 *   - namespace, metricName, stat (CloudWatch)
 *   - url, body, rootSelector, method (Infinity)
 *   - dimensions: both keys AND values
 * Fields NOT interpolated: period (always a number at this layer).
 */
function interpolateQueryConfig(
  config: DatasourceQueryConfig | undefined,
  replaceVars: ((value: string) => string) | undefined
): DatasourceQueryConfig | undefined {
  if (!config || !replaceVars) {
    return config;
  }
  const next: DatasourceQueryConfig = { ...config };
  if (config.namespace !== undefined) { next.namespace = replaceVars(config.namespace); }
  if (config.metricName !== undefined) { next.metricName = replaceVars(config.metricName); }
  if (config.stat !== undefined) { next.stat = replaceVars(config.stat); }
  if (config.url !== undefined) { next.url = replaceVars(config.url); }
  if (config.body !== undefined) { next.body = replaceVars(config.body); }
  if (config.rootSelector !== undefined) { next.rootSelector = replaceVars(config.rootSelector); }
  if (config.method !== undefined) { next.method = replaceVars(config.method); }
  if (config.dimensions) {
    const nextDims: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.dimensions)) {
      nextDims[replaceVars(k)] = replaceVars(v);
    }
    next.dimensions = nextDims;
  }
  return next;
}

export async function queryDatasource(
  dsUid: string,
  query: string,
  dsType?: string,
  queryConfig?: DatasourceQueryConfig,
  replaceVars?: (value: string) => string,
  historicalTime?: number,
  signal?: AbortSignal
): Promise<QueryResult> {
  const type = dsType || detectDatasourceType(dsUid);
  const interpolatedQuery = replaceVars ? replaceVars(query) : query;
  // Interpolate all user-controllable string fields of the queryConfig so
  // CloudWatch (namespace/metricName/dimensions/stat) and Infinity (url/
  // body/rootSelector/method) respect Grafana template variables —
  // matching the behavior of interpolatedQuery above for Prometheus.
  const interpolatedConfig = interpolateQueryConfig(queryConfig, replaceVars);

  // When no external signal is provided, give every query a 10s hard
  // ceiling so a hung datasource cannot stall Promise.all in useSelfQueries
  // until the browser's default ~2min TCP timeout.
  let effectiveSignal = signal;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (!effectiveSignal) {
    const internal = new AbortController();
    timeoutId = setTimeout(() => internal.abort(), QUERY_TIMEOUT_MS);
    effectiveSignal = internal.signal;
  }

  try {
    let inner: Promise<QueryResult>;
    switch (type) {
      case 'prometheus':
        inner = queryPrometheus(dsUid, interpolatedQuery, historicalTime, effectiveSignal);
        break;
      case 'cloudwatch':
        inner = queryCloudWatch(dsUid, interpolatedConfig, effectiveSignal);
        break;
      case 'yesoreyeram-infinity-datasource':
        inner = queryInfinity(dsUid, interpolatedConfig, effectiveSignal);
        break;
      default:
        inner = queryPrometheus(dsUid, interpolatedQuery, historicalTime, effectiveSignal);
    }

    // Stamp fetchedAt at the wrapper level so every datasource type gets it
    // for free. Awaited here — inner is guaranteed to resolve (never throws).
    const result = await inner;
    return { ...result, fetchedAt: Date.now() };
  } finally {
    if (timeoutId) { clearTimeout(timeoutId); }
  }
}

/**
 * Query Prometheus via datasource proxy API.
 * Uses instant query endpoint, returns the latest value.
 */
async function queryPrometheus(
  dsUid: string,
  query: string,
  historicalTime?: number,
  signal?: AbortSignal
): Promise<QueryResult> {
  try {
    const params: Record<string, string> = { query };
    if (historicalTime) {
      params.time = String(historicalTime);
    }
    const resp = await fetch(
      `/api/datasources/proxy/uid/${dsUid}/api/v1/query?` +
      new URLSearchParams(params),
      signal ? { signal } : undefined
    );
    if (!resp.ok) {
      console.warn('[topology] prom query http error', { dsUid, status: resp.status, query });
      return { value: null, error: 'http' };
    }
    const data = await resp.json();
    const results = data?.data?.result;
    if (!results || results.length === 0) {
      // Empty result is NOT an error — legitimate "no samples in window"
      return { value: null };
    }
    const raw = results[0].value[1];
    // Prometheus returns literal "NaN" for undefined math (division by zero,
    // rate() over a sparse range, etc.). That's a legitimate "no data in
    // window" signal, not a malformed response. Treat null/undefined/NaN as
    // empty result so the stale counter isn't polluted by false positives.
    if (raw === null || raw === undefined) {
      return { value: null };
    }
    const val = parseFloat(raw);
    if (isNaN(val)) {
      return { value: null };
    }
    return { value: val };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { value: null };
    }
    console.warn('[topology] prom network error', { dsUid, query, err });
    return { value: null, error: 'network' };
  }
}

/**
 * Query CloudWatch via Grafana's unified /api/ds/query endpoint.
 * Requires queryConfig with namespace, metricName, dimensions, stat, period.
 */
async function queryCloudWatch(
  dsUid: string,
  config?: DatasourceQueryConfig,
  signal?: AbortSignal
): Promise<QueryResult> {
  if (!config?.namespace || !config?.metricName) {
    // Missing required config — treat as empty, not error (user hasn't finished configuring)
    return { value: null };
  }
  try {
    const dimensions: Record<string, string[]> = {};
    if (config.dimensions) {
      for (const [key, val] of Object.entries(config.dimensions)) {
        dimensions[key] = [val];
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
          region: config.region || 'default',
        }],
        from: 'now-5m',
        to: 'now',
      }),
      signal,
    });
    if (!resp.ok) {
      console.warn('[topology] cloudwatch http error', { dsUid, status: resp.status, metric: config.metricName });
      return { value: null, error: 'http' };
    }
    const data = await resp.json();
    const frames = data?.results?.A?.frames;
    if (!frames || frames.length === 0) {
      return { value: null };
    }
    const values = frames[0]?.data?.values;
    if (!values || values.length < 2 || values[1].length === 0) {
      return { value: null };
    }
    // Last value in the time series. CloudWatch emits null for periods
    // without any samples in the requested window — that's a legitimate
    // "no data" signal, not a parse error.
    const val = values[1][values[1].length - 1];
    if (val === null || val === undefined) {
      return { value: null };
    }
    if (typeof val !== 'number' || isNaN(val)) {
      return { value: null };
    }
    return { value: val };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { value: null };
    }
    console.warn('[topology] cloudwatch network error', { dsUid, metric: config.metricName, err });
    return { value: null, error: 'network' };
  }
}

/**
 * Query Infinity datasource via Grafana's /api/ds/query endpoint.
 * Requires queryConfig with url, rootSelector, and optionally body/method.
 */
async function queryInfinity(
  dsUid: string,
  config?: DatasourceQueryConfig,
  signal?: AbortSignal
): Promise<QueryResult> {
  if (!config?.url) {
    // Missing URL — treat as empty, not error (user hasn't finished configuring)
    return { value: null };
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
          columns: [{ selector: 'value', text: 'Value', type: 'number' }],
        }],
        from: 'now-5m',
        to: 'now',
      }),
      signal,
    });
    if (!resp.ok) {
      console.warn('[topology] infinity http error', { dsUid, status: resp.status, url: config.url });
      return { value: null, error: 'http' };
    }
    const data = await resp.json();
    const frames = data?.results?.A?.frames;
    if (!frames || frames.length === 0) {
      return { value: null };
    }
    const values = frames[0]?.data?.values;
    if (values && values[0] && values[0].length > 0) {
      const raw = values[0][0];
      // null/undefined means the query ran fine but the aggregation was
      // empty (NRQL percentage / percentile / average on zero matching
      // rows, etc.) — legitimate "no data in window", not a parse error.
      // Flagging it as 'parse' would pollute the stale pill for sparse
      // services and drive false alarms.
      if (raw === null || raw === undefined) {
        return { value: null };
      }
      const val = parseFloat(raw);
      if (isNaN(val)) {
        return { value: null };
      }
      return { value: val };
    }
    // Fallback: check meta.custom.data for raw response
    const rawData = frames[0]?.schema?.meta?.custom?.data;
    if (typeof rawData === 'number') {
      return { value: rawData };
    }
    if (typeof rawData === 'object' && rawData !== null) {
      // Try common response shapes
      const candidate = rawData.value ?? rawData.count ?? rawData.result;
      if (typeof candidate === 'number') {
        return { value: candidate };
      }
    }
    return { value: null };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { value: null };
    }
    console.warn('[topology] infinity network error', { dsUid, url: config.url, err });
    return { value: null, error: 'network' };
  }
}

// ============================================================
// RANGE QUERIES (used by NodePopup sparklines)
// ============================================================

/**
 * Query a datasource for a range of samples over the last hour (3600s).
 * Used by NodePopup to render 1h sparklines. Routes by datasource type.
 *
 * Returns [] on any failure or for unsupported datasource types (e.g. Infinity,
 * which doesn't have a natural time-series response shape). Callers should
 * treat empty result as "no sparkline data" and render accordingly.
 */
export async function queryDatasourceRange(
  dsUid: string,
  query: string,
  queryConfig?: DatasourceQueryConfig,
  signal?: AbortSignal,
  replaceVars?: (value: string) => string
): Promise<TimeseriesPoint[]> {
  const type = detectDatasourceType(dsUid);
  switch (type) {
    case 'prometheus':
      return queryPrometheusRange(dsUid, query, signal, replaceVars);
    case 'cloudwatch':
      return queryCloudWatchRange(dsUid, queryConfig, signal, replaceVars);
    case 'yesoreyeram-infinity-datasource':
      // Infinity returns point-in-time snapshots, not time series. No natural
      // range query mapping — return empty and let the popup show "no trends".
      return [];
    default:
      return queryPrometheusRange(dsUid, query, signal, replaceVars);
  }
}

async function queryPrometheusRange(
  dsUid: string,
  query: string,
  signal?: AbortSignal,
  replaceVars?: (value: string) => string
): Promise<TimeseriesPoint[]> {
  const interpolatedQuery = replaceVars ? replaceVars(query) : query;
  if (!dsUid || !interpolatedQuery) {
    return [];
  }
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 3600;
    const resp = await fetch(
      `/api/datasources/proxy/uid/${dsUid}/api/v1/query_range?` +
      new URLSearchParams({ query: interpolatedQuery, start: String(start), end: String(end), step: '60' }),
      signal ? { signal } : undefined
    );
    if (!resp.ok) {
      return [];
    }
    const data = await resp.json();
    const result = data?.data?.result?.[0]?.values;
    if (!Array.isArray(result)) {
      return [];
    }
    const points: TimeseriesPoint[] = [];
    for (const row of result) {
      const ts = typeof row?.[0] === 'number' ? row[0] : parseFloat(row?.[0]);
      const val = parseFloat(row?.[1]);
      if (!isNaN(ts) && !isNaN(val)) {
        points.push({ timestamp: ts, value: val });
      }
    }
    return points;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return [];
    }
    console.warn('[topology] prom range error', { dsUid, query: interpolatedQuery, err });
    return [];
  }
}

async function queryCloudWatchRange(
  dsUid: string,
  config?: DatasourceQueryConfig,
  signal?: AbortSignal,
  replaceVars?: (value: string) => string
): Promise<TimeseriesPoint[]> {
  const interpolated = interpolateQueryConfig(config, replaceVars);
  if (!interpolated?.namespace || !interpolated?.metricName) {
    return [];
  }
  try {
    const dimensions: Record<string, string[]> = {};
    if (interpolated.dimensions) {
      for (const [k, v] of Object.entries(interpolated.dimensions)) {
        dimensions[k] = [v];
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
          namespace: interpolated.namespace,
          metricName: interpolated.metricName,
          dimensions,
          statistic: interpolated.stat || 'Average',
          period: String(interpolated.period || 60),
          region: interpolated.region || 'default',
        }],
        from: 'now-1h',
        to: 'now',
      }),
      signal,
    });
    if (!resp.ok) {
      return [];
    }
    const data = await resp.json();
    const frames = data?.results?.A?.frames;
    if (!Array.isArray(frames) || frames.length === 0) {
      return [];
    }
    const values = frames[0]?.data?.values;
    if (!Array.isArray(values) || values.length < 2) {
      return [];
    }
    // CloudWatch frames return [timestamps[], values[]] in data.values
    const timestamps = values[0] as number[];
    const nums = values[1] as number[];
    const points: TimeseriesPoint[] = [];
    for (let i = 0; i < timestamps.length && i < nums.length; i++) {
      const ts = timestamps[i];
      const v = nums[i];
      if (typeof ts === 'number' && typeof v === 'number' && !isNaN(v)) {
        // CloudWatch timestamps are in milliseconds — normalise to seconds for consistency
        points.push({ timestamp: ts > 1e12 ? Math.floor(ts / 1000) : ts, value: v });
      }
    }
    return points;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return [];
    }
    console.warn('[topology] cloudwatch range error', { dsUid, metric: interpolated.metricName, err });
    return [];
  }
}
