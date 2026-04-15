jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: jest.fn(),
}));

import { getDataSourceSrv } from '@grafana/runtime';
import {
  resolvePrometheusTargets,
  resolveCloudWatchTargets,
  resolveInfinityTargets,
  resolveDynamicTargets,
} from '../dynamicTargets';
import { TopologyEdge } from '../../types';

const mockGetDataSourceSrv = getDataSourceSrv as jest.Mock;

function mockDsType(type: string): void {
  mockGetDataSourceSrv.mockReturnValue({
    getInstanceSettings: jest.fn().mockReturnValue({ type }),
  });
}

function mockFetchOk(body: unknown): void {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

function mockFetchError(status: number): void {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  });
}

function makeDynamicEdge(overrides: Partial<TopologyEdge> = {}): TopologyEdge {
  return {
    id: 'e1',
    sourceId: 's1',
    type: 'traffic',
    thicknessMode: 'fixed',
    thicknessMin: 1.5,
    thicknessMax: 4,
    thresholds: [],
    flowAnimation: true,
    bidirectional: false,
    anchorSource: 'auto',
    anchorTarget: 'auto',
    targetQuery: {
      datasourceUid: 'ds-1',
      query: 'up{job="x"}',
      nodeIdLabel: 'instance',
    },
    ...overrides,
  };
}

describe('resolvePrometheusTargets', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); jest.restoreAllMocks(); });

  test('extracts unique label values from query result', async () => {
    mockFetchOk({
      data: {
        result: [
          { metric: { instance: 'web-01:9100', job: 'app' } },
          { metric: { instance: 'web-02:9100', job: 'app' } },
          { metric: { instance: 'web-01:9100', job: 'other' } }, // duplicate instance
        ],
      },
    });
    const result = await resolvePrometheusTargets('ds-1', 'up', 'instance');
    expect(result.sort()).toEqual(['web-01:9100', 'web-02:9100']);
  });

  test('http error returns empty list and warns', async () => {
    mockFetchError(500);
    const result = await resolvePrometheusTargets('ds-1', 'up', 'instance');
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('network error returns empty and warns', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error('net'));
    const result = await resolvePrometheusTargets('ds-1', 'up', 'instance');
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('AbortError is rethrown', async () => {
    const ae = new Error('aborted');
    ae.name = 'AbortError';
    (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(ae);
    await expect(resolvePrometheusTargets('ds-1', 'up', 'instance')).rejects.toThrow('aborted');
  });

  test('missing parameters returns empty immediately', async () => {
    expect(await resolvePrometheusTargets('', 'up', 'instance')).toEqual([]);
    expect(await resolvePrometheusTargets('ds-1', '', 'instance')).toEqual([]);
    expect(await resolvePrometheusTargets('ds-1', 'up', '')).toEqual([]);
  });

  test('non-array result returns empty', async () => {
    mockFetchOk({ data: { result: null } });
    expect(await resolvePrometheusTargets('ds-1', 'up', 'instance')).toEqual([]);
  });

  test('skips entries where label is missing or non-string', async () => {
    mockFetchOk({
      data: {
        result: [
          { metric: { instance: 'web-01' } },
          { metric: { other: 'x' } }, // no `instance`
          { metric: { instance: 42 } }, // not a string
          { metric: {} },
        ],
      },
    });
    const result = await resolvePrometheusTargets('ds-1', 'up', 'instance');
    expect(result).toEqual(['web-01']);
  });
});

describe('resolveCloudWatchTargets', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test('parses frame names for nodeIdLabel dimension values', async () => {
    mockFetchOk({
      results: {
        A: {
          frames: [
            { schema: { name: 'RequestCount {LoadBalancer=app/alb-1/abc, Region=us-east-1}' } },
            { schema: { name: 'RequestCount {LoadBalancer=app/alb-2/def, Region=us-east-1}' } },
            { schema: { name: 'RequestCount {LoadBalancer=app/alb-1/abc, Region=us-west-2}' } }, // duplicate
          ],
        },
      },
    });
    const result = await resolveCloudWatchTargets('ds-1', { namespace: 'AWS/ApplicationELB', metricName: 'RequestCount' }, 'LoadBalancer');
    expect(result.sort()).toEqual(['app/alb-1/abc', 'app/alb-2/def']);
  });

  test('missing config returns empty', async () => {
    expect(await resolveCloudWatchTargets('ds-1', {}, 'LoadBalancer')).toEqual([]);
  });

  test('missing nodeIdLabel returns empty', async () => {
    expect(await resolveCloudWatchTargets('ds-1', { namespace: 'X', metricName: 'Y' }, '')).toEqual([]);
  });

  test('omits discovery dimension from filter list when building request', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: { A: { frames: [] } } }),
    });
    global.fetch = fetchMock;
    await resolveCloudWatchTargets(
      'ds-1',
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'RequestCount',
        dimensions: { LoadBalancer: 'app/abc', Region: 'us-east-1' },
      },
      'LoadBalancer'
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const sentDims = body.queries[0].dimensions;
    expect(sentDims.LoadBalancer).toBeUndefined();
    expect(sentDims.Region).toEqual(['us-east-1']);
  });

  test('http error returns empty', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchError(500);
    const result = await resolveCloudWatchTargets('ds-1', { namespace: 'X', metricName: 'Y' }, 'Label');
    expect(result).toEqual([]);
  });
});

describe('resolveInfinityTargets', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test('extracts unique string values from first column', async () => {
    mockFetchOk({
      results: {
        A: {
          frames: [{ data: { values: [['web-01', 'web-02', 'web-01', 'web-03']] } }],
        },
      },
    });
    const result = await resolveInfinityTargets('ds-1', { url: 'https://x.y' }, 'hostname');
    expect(result.sort()).toEqual(['web-01', 'web-02', 'web-03']);
  });

  test('converts numeric values to strings', async () => {
    mockFetchOk({
      results: {
        A: {
          frames: [{ data: { values: [[1, 2, 3]] } }],
        },
      },
    });
    const result = await resolveInfinityTargets('ds-1', { url: 'https://x.y' }, 'id');
    expect(result.sort()).toEqual(['1', '2', '3']);
  });

  test('missing url returns empty', async () => {
    expect(await resolveInfinityTargets('ds-1', {}, 'label')).toEqual([]);
  });

  test('http error returns empty', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchError(500);
    const result = await resolveInfinityTargets('ds-1', { url: 'https://x.y' }, 'label');
    expect(result).toEqual([]);
  });
});

describe('resolveDynamicTargets — routing', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test('empty list returns empty map', async () => {
    const result = await resolveDynamicTargets([]);
    expect(result.size).toBe(0);
  });

  test('skips edges without targetQuery', async () => {
    const edges: TopologyEdge[] = [
      {
        id: 'static',
        sourceId: 's',
        targetId: 't',
        type: 'traffic',
        thicknessMode: 'fixed',
        thicknessMin: 1.5,
        thicknessMax: 4,
        thresholds: [],
        flowAnimation: true,
        bidirectional: false,
        anchorSource: 'auto',
        anchorTarget: 'auto',
      },
    ];
    const result = await resolveDynamicTargets(edges);
    expect(result.size).toBe(0);
  });

  test('routes Prometheus to resolvePrometheusTargets', async () => {
    mockDsType('prometheus');
    mockFetchOk({
      data: { result: [{ metric: { instance: 'w-1' } }, { metric: { instance: 'w-2' } }] },
    });
    const result = await resolveDynamicTargets([makeDynamicEdge()]);
    expect(result.get('e1')?.sort()).toEqual(['w-1', 'w-2']);
  });

  test('routes CloudWatch to resolveCloudWatchTargets', async () => {
    mockDsType('cloudwatch');
    mockFetchOk({
      results: {
        A: {
          frames: [{ schema: { name: 'X {LoadBalancer=lb-1}' } }, { schema: { name: 'X {LoadBalancer=lb-2}' } }],
        },
      },
    });
    const edge = makeDynamicEdge({
      targetQuery: {
        datasourceUid: 'ds-1',
        query: '',
        nodeIdLabel: 'LoadBalancer',
        queryConfig: { namespace: 'AWS/ApplicationELB', metricName: 'RequestCount' },
      },
    });
    const result = await resolveDynamicTargets([edge]);
    expect(result.get('e1')?.sort()).toEqual(['lb-1', 'lb-2']);
  });

  test('routes Infinity to resolveInfinityTargets', async () => {
    mockDsType('yesoreyeram-infinity-datasource');
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [['host-1', 'host-2']] } }] } },
    });
    const edge = makeDynamicEdge({
      targetQuery: {
        datasourceUid: 'ds-1',
        query: '',
        nodeIdLabel: 'hostname',
        queryConfig: { url: 'https://api.example.com' },
      },
    });
    const result = await resolveDynamicTargets([edge]);
    expect(result.get('e1')?.sort()).toEqual(['host-1', 'host-2']);
  });

  test('filters out edges without nodeIdLabel', async () => {
    mockDsType('prometheus');
    const edge = makeDynamicEdge({ targetQuery: { datasourceUid: 'ds-1', query: 'up', nodeIdLabel: '' } });
    const result = await resolveDynamicTargets([edge]);
    expect(result.size).toBe(0);
  });
});
