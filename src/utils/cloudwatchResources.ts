/**
 * cloudwatchResources.ts — thin wrappers around Grafana's CloudWatch
 * datasource resource API. Used by MetricEditor and EdgeCard to
 * populate Namespace / Metric name / Dimension key dropdowns with
 * live AWS data instead of plain text inputs.
 *
 * Endpoints (all GET, all require a region query param):
 *   /api/datasources/uid/{uid}/resources/namespaces
 *   /api/datasources/uid/{uid}/resources/metrics?namespace=
 *   /api/datasources/uid/{uid}/resources/dimension-keys?namespace=&metricName=&dimensionFilters={}
 *
 * Each endpoint returns an array of `{ label?, value, text? }`.
 * We normalize to `string[]` and let callers wrap into Grafana
 * SelectableValue shape.
 */

import { getDataSourceSrv } from '@grafana/runtime';

/**
 * Resolve the datasource's default region from its instanceSettings.jsonData.
 * Falls back to 'us-east-1' if unset.
 */
export function getCloudWatchDefaultRegion(dsUid: string): string {
  try {
    const settings = getDataSourceSrv().getInstanceSettings(dsUid);
    const jsonData = settings?.jsonData as { defaultRegion?: string } | undefined;
    return jsonData?.defaultRegion || 'us-east-1';
  } catch {
    return 'us-east-1';
  }
}

interface ResourceEntry {
  label?: string;
  value?: string;
  text?: string;
}

async function fetchResource(dsUid: string, path: string): Promise<string[]> {
  const res = await fetch(`/api/datasources/uid/${dsUid}/resources/${path}`);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as ResourceEntry[] | unknown;
  if (!Array.isArray(data)) {
    return [];
  }
  // Normalize: prefer `value`, fall back to `text` (older handlers use text).
  return data
    .map((entry) => entry?.value ?? entry?.text ?? '')
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** List AWS namespaces available to the datasource in the given region. */
export function fetchCwNamespaces(dsUid: string, region: string): Promise<string[]> {
  return fetchResource(dsUid, `namespaces?region=${encodeURIComponent(region)}`);
}

/** List metric names in a namespace (e.g. CPUUtilization for AWS/EC2). */
export function fetchCwMetrics(dsUid: string, region: string, namespace: string): Promise<string[]> {
  const qs = `region=${encodeURIComponent(region)}&namespace=${encodeURIComponent(namespace)}`;
  return fetchResource(dsUid, `metrics?${qs}`);
}

/** List dimension keys for a specific metric in a namespace. */
export function fetchCwDimensionKeys(
  dsUid: string,
  region: string,
  namespace: string,
  metricName: string
): Promise<string[]> {
  const qs =
    `region=${encodeURIComponent(region)}` +
    `&namespace=${encodeURIComponent(namespace)}` +
    `&metricName=${encodeURIComponent(metricName)}` +
    `&dimensionFilters=${encodeURIComponent('{}')}`;
  return fetchResource(dsUid, `dimension-keys?${qs}`);
}
