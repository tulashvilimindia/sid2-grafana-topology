// Mock @grafana/runtime before the SUT is imported — getCloudWatchDefaultRegion
// reads jsonData.defaultRegion from getDataSourceSrv().getInstanceSettings().
const getDataSourceSrvMock = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => getDataSourceSrvMock(),
}));

import {
  AWS_REGIONS,
  getCloudWatchDefaultRegion,
  fetchCwNamespaces,
  fetchCwMetrics,
  fetchCwDimensionKeys,
} from '../cloudwatchResources';

function mockFetchOk(body: unknown): void {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: true,
    statusText: 'OK',
    json: async () => body,
  });
}

function mockFetchError(status: number, statusText = 'Server Error'): void {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  });
}

beforeEach(() => {
  getDataSourceSrvMock.mockReset();
});

// ─── AWS_REGIONS constant ─────────────────────────────────────────────

describe('AWS_REGIONS', () => {
  test('is a non-empty list of { label, value } entries', () => {
    expect(Array.isArray(AWS_REGIONS)).toBe(true);
    expect(AWS_REGIONS.length).toBeGreaterThan(10);
    for (const r of AWS_REGIONS) {
      expect(typeof r.label).toBe('string');
      expect(typeof r.value).toBe('string');
    }
  });

  test('includes the common primary regions', () => {
    const values = AWS_REGIONS.map((r) => r.value);
    expect(values).toEqual(expect.arrayContaining(['us-east-1', 'us-west-2', 'eu-west-1']));
  });
});

// ─── getCloudWatchDefaultRegion ────────────────────────────────────────

describe('getCloudWatchDefaultRegion', () => {
  test('reads jsonData.defaultRegion from getInstanceSettings', () => {
    getDataSourceSrvMock.mockReturnValue({
      getInstanceSettings: () => ({ jsonData: { defaultRegion: 'eu-west-2' } }),
    });
    expect(getCloudWatchDefaultRegion('ds-cw')).toBe('eu-west-2');
  });

  test('falls back to us-east-1 when jsonData.defaultRegion is missing', () => {
    getDataSourceSrvMock.mockReturnValue({
      getInstanceSettings: () => ({ jsonData: {} }),
    });
    expect(getCloudWatchDefaultRegion('ds-cw')).toBe('us-east-1');
  });

  test('falls back to us-east-1 when jsonData itself is undefined', () => {
    getDataSourceSrvMock.mockReturnValue({
      getInstanceSettings: () => ({}),
    });
    expect(getCloudWatchDefaultRegion('ds-cw')).toBe('us-east-1');
  });

  test('falls back to us-east-1 when getDataSourceSrv throws', () => {
    getDataSourceSrvMock.mockImplementation(() => {
      throw new Error('srv unavailable');
    });
    expect(getCloudWatchDefaultRegion('ds-cw')).toBe('us-east-1');
  });
});

// ─── fetchCwNamespaces ─────────────────────────────────────────────────

describe('fetchCwNamespaces', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sends the region query parameter on the namespaces endpoint', async () => {
    mockFetchOk([{ value: 'AWS/EC2' }, { value: 'AWS/ApplicationELB' }]);
    const result = await fetchCwNamespaces('ds-cw', 'eu-west-2');
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toBe('/api/datasources/uid/ds-cw/resources/namespaces?region=eu-west-2');
    expect(result).toEqual(['AWS/EC2', 'AWS/ApplicationELB']);
  });

  test('accepts the { text } legacy shape via the `value || text` selector', async () => {
    mockFetchOk([{ text: 'AWS/Lambda' }]);
    const result = await fetchCwNamespaces('ds-cw', 'us-east-1');
    expect(result).toEqual(['AWS/Lambda']);
  });

  test('filters out entries without a string value or text', async () => {
    mockFetchOk([
      { value: 'keep-1' },
      { value: 42 }, // non-string: filtered
      { label: 'no-value' }, // no value/text: filtered
      null, // non-object: filtered
      { value: '' }, // empty string: filtered
      { text: 'keep-2' },
    ]);
    const result = await fetchCwNamespaces('ds-cw', 'us-east-1');
    expect(result).toEqual(['keep-1', 'keep-2']);
  });

  test('returns empty array when response is not an array', async () => {
    mockFetchOk({ unexpected: 'shape' });
    const result = await fetchCwNamespaces('ds-cw', 'us-east-1');
    expect(result).toEqual([]);
  });

  test('throws on HTTP error (does not swallow) so callers surface the status', async () => {
    mockFetchError(403, 'Forbidden');
    await expect(fetchCwNamespaces('ds-cw', 'us-east-1')).rejects.toThrow(/403/);
  });

  test('URL-encodes special characters in the region value', async () => {
    mockFetchOk([]);
    await fetchCwNamespaces('ds-cw', 'weird region/value');
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('weird%20region%2Fvalue');
  });
});

// ─── fetchCwMetrics ────────────────────────────────────────────────────

describe('fetchCwMetrics', () => {
  test('sends region + namespace query params on the metrics endpoint', async () => {
    mockFetchOk([{ value: { name: 'CPUUtilization', namespace: 'AWS/EC2' } }]);
    await fetchCwMetrics('ds-cw', 'us-east-1', 'AWS/EC2');
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      '/api/datasources/uid/ds-cw/resources/metrics?region=us-east-1&namespace=AWS%2FEC2'
    );
  });

  test('extracts metric name from the modern { value: { name, namespace } } shape', async () => {
    mockFetchOk([
      { value: { name: 'CPUUtilization', namespace: 'AWS/EC2' } },
      { value: { name: 'NetworkIn', namespace: 'AWS/EC2' } },
    ]);
    const result = await fetchCwMetrics('ds-cw', 'us-east-1', 'AWS/EC2');
    expect(result).toEqual(['CPUUtilization', 'NetworkIn']);
  });

  test('falls back to legacy flat { value: string } shape', async () => {
    mockFetchOk([{ value: 'CPUUtilization' }, { value: 'NetworkIn' }]);
    const result = await fetchCwMetrics('ds-cw', 'us-east-1', 'AWS/EC2');
    expect(result).toEqual(['CPUUtilization', 'NetworkIn']);
  });

  test('throws on HTTP error', async () => {
    mockFetchError(500);
    await expect(fetchCwMetrics('ds-cw', 'us-east-1', 'AWS/EC2')).rejects.toThrow(/500/);
  });
});

// ─── fetchCwDimensionKeys ──────────────────────────────────────────────

describe('fetchCwDimensionKeys', () => {
  test('sends region + namespace + metricName + empty dimensionFilters', async () => {
    mockFetchOk([{ value: 'InstanceId' }, { value: 'AutoScalingGroupName' }]);
    const result = await fetchCwDimensionKeys('ds-cw', 'us-east-1', 'AWS/EC2', 'CPUUtilization');
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('region=us-east-1');
    expect(calledUrl).toContain('namespace=AWS%2FEC2');
    expect(calledUrl).toContain('metricName=CPUUtilization');
    expect(calledUrl).toContain('dimensionFilters=%7B%7D'); // encoded '{}'
    expect(result).toEqual(['InstanceId', 'AutoScalingGroupName']);
  });

  test('returns empty array on empty response (no dimension keys available)', async () => {
    mockFetchOk([]);
    const result = await fetchCwDimensionKeys('ds-cw', 'us-east-1', 'AWS/EC2', 'CPUUtilization');
    expect(result).toEqual([]);
  });

  test('throws on HTTP error so the editor can render a "check AWS creds" banner', async () => {
    mockFetchError(401, 'Unauthorized');
    await expect(
      fetchCwDimensionKeys('ds-cw', 'us-east-1', 'AWS/EC2', 'CPUUtilization')
    ).rejects.toThrow(/401/);
  });
});
