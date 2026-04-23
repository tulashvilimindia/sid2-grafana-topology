// Mock @grafana/runtime BEFORE importing the module under test
jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: jest.fn(),
}));

import { getDataSourceSrv } from '@grafana/runtime';
import {
  queryDatasource,
  queryDatasourceRange,
  detectDatasourceType,
} from '../datasourceQuery';

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

describe('detectDatasourceType', () => {
  test('returns datasource type for known uid', () => {
    mockDsType('prometheus');
    expect(detectDatasourceType('uid-1')).toBe('prometheus');
  });

  test('returns unknown when getInstanceSettings returns null', () => {
    mockGetDataSourceSrv.mockReturnValue({
      getInstanceSettings: jest.fn().mockReturnValue(null),
    });
    expect(detectDatasourceType('uid-1')).toBe('unknown');
  });

  test('returns unknown when getDataSourceSrv throws', () => {
    mockGetDataSourceSrv.mockImplementation(() => {
      throw new Error('srv unavailable');
    });
    expect(detectDatasourceType('uid-1')).toBe('unknown');
  });
});

describe('queryDatasource — Prometheus path', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockDsType('prometheus');
  });
  afterEach(() => { warnSpy.mockRestore(); jest.restoreAllMocks(); });

  test('parses numeric value from Prometheus instant query', async () => {
    mockFetchOk({
      data: {
        result: [{ metric: {}, value: [1234567890, '42.5'] }],
      },
    });
    const result = await queryDatasource('uid-1', 'up');
    expect(result).toMatchObject({ value: 42.5 });
  });

  test('stamps fetchedAt on successful result', async () => {
    mockFetchOk({
      data: { result: [{ metric: {}, value: [1234567890, '1'] }] },
    });
    const before = Date.now();
    const result = await queryDatasource('uid-1', 'up');
    const after = Date.now();
    expect(result.fetchedAt).toBeDefined();
    expect(result.fetchedAt!).toBeGreaterThanOrEqual(before);
    expect(result.fetchedAt!).toBeLessThanOrEqual(after);
  });

  test('stamps fetchedAt on error result as well', async () => {
    mockFetchError(500);
    const result = await queryDatasource('uid-1', 'up');
    expect(result.error).toBe('http');
    expect(result.fetchedAt).toBeDefined();
    expect(typeof result.fetchedAt).toBe('number');
  });


  test('empty result returns null value with no error', async () => {
    mockFetchOk({ data: { result: [] } });
    const result = await queryDatasource('uid-1', 'up');
    expect(result).toMatchObject({ value: null });
  });

  test('http error returns error http', async () => {
    mockFetchError(502);
    const result = await queryDatasource('uid-1', 'up');
    expect(result).toMatchObject({ value: null, error: 'http' });
    expect(warnSpy).toHaveBeenCalled();
  });

  test('non-numeric Prometheus value treated as empty (no parse error)', async () => {
    // Prometheus returns literal "NaN" for undefined math (rate() on sparse
    // data, division by zero, etc.). Those are legitimate "no data" signals,
    // not malformed responses — should NOT be flagged as parse error.
    mockFetchOk({
      data: { result: [{ metric: {}, value: [1234567890, 'not-a-number'] }] },
    });
    const result = await queryDatasource('uid-1', 'up');
    expect(result).toEqual(expect.objectContaining({ value: null }));
    expect(result.error).toBeUndefined();
  });

  test('null Prometheus value treated as empty', async () => {
    mockFetchOk({
      data: { result: [{ metric: {}, value: [1234567890, null] }] },
    });
    const result = await queryDatasource('uid-1', 'up');
    expect(result).toEqual(expect.objectContaining({ value: null }));
    expect(result.error).toBeUndefined();
  });

  test('network error returns error network', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error('offline'));
    const result = await queryDatasource('uid-1', 'up');
    expect(result).toMatchObject({ value: null, error: 'network' });
    expect(warnSpy).toHaveBeenCalled();
  });

  test('AbortError is silently swallowed as empty (no warn, no error flag)', async () => {
    const ae = new Error('aborted');
    ae.name = 'AbortError';
    (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(ae);
    const result = await queryDatasource('uid-1', 'up');
    expect(result).toMatchObject({ value: null });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('historicalTime adds time param to URL', async () => {
    mockFetchOk({ data: { result: [{ value: [0, '1'] }] } });
    await queryDatasource('uid-1', 'up', undefined, undefined, undefined, 1234567890);
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('time=1234567890');
  });
});

describe('queryDatasource — CloudWatch path', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockDsType('cloudwatch');
  });
  afterEach(() => { warnSpy.mockRestore(); jest.restoreAllMocks(); });

  test('returns null with no error when required config is missing', async () => {
    const result = await queryDatasource('uid-1', '', undefined, {});
    expect(result).toMatchObject({ value: null });
  });

  test('parses last value from a valid CloudWatch response', async () => {
    mockFetchOk({
      results: {
        A: {
          frames: [
            { data: { values: [[1000, 2000, 3000], [1, 2, 3]] } },
          ],
        },
      },
    });
    const result = await queryDatasource('uid-1', '', undefined, {
      namespace: 'AWS/ApplicationELB',
      metricName: 'RequestCount',
      dimensions: { LoadBalancer: 'app/abc' },
    });
    expect(result).toMatchObject({ value: 3 });
  });

  test('empty frames returns null without error', async () => {
    mockFetchOk({ results: { A: { frames: [] } } });
    const result = await queryDatasource('uid-1', '', undefined, {
      namespace: 'AWS/ApplicationELB',
      metricName: 'RequestCount',
    });
    expect(result).toMatchObject({ value: null });
  });

  test('http error returns error http', async () => {
    mockFetchError(500);
    const result = await queryDatasource('uid-1', '', undefined, {
      namespace: 'AWS/ApplicationELB',
      metricName: 'RequestCount',
    });
    expect(result).toMatchObject({ value: null, error: 'http' });
  });

  test('parse error when last value is non-numeric', async () => {
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[1000, 2000], [1, null]] } }] } },
    });
    const result = await queryDatasource('uid-1', '', undefined, {
      namespace: 'AWS/ApplicationELB',
      metricName: 'RequestCount',
    });
    // CloudWatch returns null for periods without samples — legitimate
    // "no data", not a parse error.
    expect(result).toEqual(expect.objectContaining({ value: null }));
    expect(result.error).toBeUndefined();
  });

  test('network error returns error network', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error('timeout'));
    const result = await queryDatasource('uid-1', '', undefined, {
      namespace: 'AWS/ApplicationELB',
      metricName: 'RequestCount',
    });
    expect(result).toMatchObject({ value: null, error: 'network' });
  });

  test('values array too short returns null without error', async () => {
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[1000]] } }] } },
    });
    const result = await queryDatasource('uid-1', '', undefined, {
      namespace: 'AWS/ApplicationELB',
      metricName: 'RequestCount',
    });
    expect(result).toMatchObject({ value: null });
  });

  // ─── Region regression (was hardcoded 'default' for months) ─────────────
  //
  // `DatasourceQueryConfig.region` is declared in types.ts and written by the
  // editor's region picker, but the query layer used to hardcode
  // `region: 'default'` and silently drop it. The tests below lock in that
  // the user's region selection actually reaches the API payload.
  test('forwards queryConfig.region into CloudWatch request body', async () => {
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[1], [3]] } }] } },
    });
    await queryDatasource('uid-1', '', undefined, {
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      region: 'eu-west-2',
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.queries[0].region).toBe('eu-west-2');
  });

  test('falls back to "default" when queryConfig.region is absent', async () => {
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[1], [3]] } }] } },
    });
    await queryDatasource('uid-1', '', undefined, {
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.queries[0].region).toBe('default');
  });
});

describe('queryDatasource — Infinity path', () => {
  beforeEach(() => { mockDsType('yesoreyeram-infinity-datasource'); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('returns null with no error when url is missing', async () => {
    const result = await queryDatasource('uid-1', '', undefined, {});
    expect(result).toMatchObject({ value: null });
  });

  test('parses first value from frame data', async () => {
    mockFetchOk({
      results: {
        A: {
          frames: [{ data: { values: [['42.7']] } }],
        },
      },
    });
    const result = await queryDatasource('uid-1', '', undefined, { url: 'https://x.y' });
    expect(result).toMatchObject({ value: 42.7 });
  });

  test('falls back to meta.custom.data.value when frame values are empty', async () => {
    mockFetchOk({
      results: {
        A: {
          frames: [{ data: { values: [[]] }, schema: { meta: { custom: { data: { value: 99 } } } } }],
        },
      },
    });
    const result = await queryDatasource('uid-1', '', undefined, { url: 'https://x.y' });
    expect(result).toMatchObject({ value: 99 });
  });

  test('http error returns error http', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchError(500);
    const result = await queryDatasource('uid-1', '', undefined, { url: 'https://x.y' });
    expect(result).toMatchObject({ value: null, error: 'http' });
  });

  test('null first value treated as empty (NRQL percentage/percentile on zero rows)', async () => {
    // NRQL returns null for percentage/percentile/average over zero matching
    // rows — legitimate "no data in window", not a parse error. Flagging
    // it as parse error would pollute the stale counter for sparse services.
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[null]] } }] } },
    });
    const result = await queryDatasource('uid-1', '', undefined, { url: 'https://x.y' });
    expect(result).toEqual(expect.objectContaining({ value: null }));
    expect(result.error).toBeUndefined();
  });

  test('non-numeric first value also treated as empty (no parse error flag)', async () => {
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [['not-a-number']] } }] } },
    });
    const result = await queryDatasource('uid-1', '', undefined, { url: 'https://x.y' });
    expect(result).toEqual(expect.objectContaining({ value: null }));
    expect(result.error).toBeUndefined();
  });

  test('network error returns error network', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error('offline'));
    const result = await queryDatasource('uid-1', '', undefined, { url: 'https://x.y' });
    expect(result).toMatchObject({ value: null, error: 'network' });
  });

  test('empty frames returns null without error', async () => {
    mockFetchOk({ results: { A: { frames: [] } } });
    const result = await queryDatasource('uid-1', '', undefined, { url: 'https://x.y' });
    expect(result).toMatchObject({ value: null });
  });
});

describe('queryDatasourceRange', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test('Prometheus returns timeseries points from query_range', async () => {
    mockDsType('prometheus');
    mockFetchOk({
      data: {
        result: [{ values: [[1000, '10'], [2000, '20'], [3000, '30']] }],
      },
    });
    const points = await queryDatasourceRange('uid-1', 'up');
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ timestamp: 1000, value: 10 });
    expect(points[2]).toEqual({ timestamp: 3000, value: 30 });
  });

  test('Prometheus handles empty result', async () => {
    mockDsType('prometheus');
    mockFetchOk({ data: { result: [] } });
    const points = await queryDatasourceRange('uid-1', 'up');
    expect(points).toEqual([]);
  });

  test('CloudWatch returns timeseries points from frames', async () => {
    mockDsType('cloudwatch');
    mockFetchOk({
      results: {
        A: {
          frames: [{ data: { values: [[1000, 2000], [10, 20]] } }],
        },
      },
    });
    const points = await queryDatasourceRange('uid-1', '', { namespace: 'AWS/EC2', metricName: 'CPUUtilization' });
    expect(points).toHaveLength(2);
  });

  test('CloudWatch normalises millisecond timestamps to seconds', async () => {
    mockDsType('cloudwatch');
    const msTimestamp = 1700000000000; // 13 digits = milliseconds
    mockFetchOk({
      results: {
        A: {
          frames: [{ data: { values: [[msTimestamp], [42]] } }],
        },
      },
    });
    const points = await queryDatasourceRange('uid-1', '', { namespace: 'AWS/EC2', metricName: 'CPUUtilization' });
    expect(points[0].timestamp).toBe(Math.floor(msTimestamp / 1000));
  });

  test('Infinity returns empty array (no natural time series)', async () => {
    mockDsType('yesoreyeram-infinity-datasource');
    const points = await queryDatasourceRange('uid-1', 'ignored');
    expect(points).toEqual([]);
  });

  test('Prometheus range http error returns empty', async () => {
    mockDsType('prometheus');
    mockFetchError(502);
    const points = await queryDatasourceRange('uid-1', 'up');
    expect(points).toEqual([]);
  });

  test('Prometheus range missing query returns empty', async () => {
    mockDsType('prometheus');
    const points = await queryDatasourceRange('uid-1', '');
    expect(points).toEqual([]);
  });

  test('Prometheus range network error returns empty', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockDsType('prometheus');
    (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error('net'));
    const points = await queryDatasourceRange('uid-1', 'up');
    expect(points).toEqual([]);
  });

  test('CloudWatch range missing config returns empty', async () => {
    mockDsType('cloudwatch');
    const points = await queryDatasourceRange('uid-1', '', {});
    expect(points).toEqual([]);
  });

  test('CloudWatch range http error returns empty', async () => {
    mockDsType('cloudwatch');
    mockFetchError(500);
    const points = await queryDatasourceRange('uid-1', '', { namespace: 'X', metricName: 'Y' });
    expect(points).toEqual([]);
  });

  test('CloudWatch range forwards queryConfig.region into request body', async () => {
    mockDsType('cloudwatch');
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[1000], [42]] } }] } },
    });
    await queryDatasourceRange('uid-1', '', {
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      region: 'ap-southeast-2',
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.queries[0].region).toBe('ap-southeast-2');
  });

  test('CloudWatch range empty frames returns empty', async () => {
    mockDsType('cloudwatch');
    mockFetchOk({ results: { A: { frames: [] } } });
    const points = await queryDatasourceRange('uid-1', '', { namespace: 'X', metricName: 'Y' });
    expect(points).toEqual([]);
  });

  test('unknown datasource type falls back to Prometheus range', async () => {
    mockDsType('unknown-type');
    mockFetchOk({ data: { result: [{ values: [[1000, '5']] }] } });
    const points = await queryDatasourceRange('uid-1', 'up');
    expect(points).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Template variable interpolation
//
// These tests prove Grafana's replaceVariables function is applied to
// every user-controllable string field of the DatasourceQueryConfig for
// all three supported datasource types (Prometheus, CloudWatch, Infinity).
// Previously, only the Prometheus PromQL string was interpolated;
// CloudWatch and Infinity silently passed raw $var tokens through to the
// datasource, which then returned empty data.
// ─────────────────────────────────────────────────────────────────────

// ─── Internal 10s hard-ceiling timeout ───────────────────────────────
//
// When the caller doesn't provide an AbortSignal, queryDatasource spins up
// its own AbortController + 10s setTimeout so a hung datasource can't stall
// the Promise.all in useSelfQueries for ~2min (the default TCP timeout).
// Locked in via fake timers + a never-resolving fetch mock.
describe('queryDatasource — internal timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockDsType('prometheus');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('aborts the signal after 10_000ms when the datasource hangs', async () => {
    let capturedSignal: AbortSignal | undefined;
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((_url, init) => {
      capturedSignal = init?.signal;
      // Return a promise that resolves only when the signal aborts — mimics
      // real fetch behaviour when the caller cancels.
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const promise = queryDatasource('uid-1', 'up');
    // Signal is created and passed into fetch.
    await Promise.resolve();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
    // 9999ms — still not aborted.
    await Promise.resolve();
    jest.advanceTimersByTime(9_999);
    expect(capturedSignal!.aborted).toBe(false);
    // One more millisecond — internal controller fires abort.
    jest.advanceTimersByTime(1);
    expect(capturedSignal!.aborted).toBe(true);
    // The resulting promise resolves (AbortError is swallowed to {value: null}).
    await expect(promise).resolves.toEqual(expect.objectContaining({ value: null }));
  });

  test('external signal bypasses the internal 10s timeout', async () => {
    const externalController = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((_url, init) => {
      capturedSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        // Mirror real fetch: reject with AbortError when the signal aborts.
        capturedSignal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const promise = queryDatasource(
      'uid-1', 'up', undefined, undefined, undefined, undefined, externalController.signal
    );
    await Promise.resolve();
    // Advance past the would-have-fired internal timeout — the external
    // signal must remain in control, so no abort yet.
    jest.advanceTimersByTime(10_001);
    expect(capturedSignal!.aborted).toBe(false);
    // External abort propagates — confirms external signal is the one wired in.
    externalController.abort();
    expect(capturedSignal!.aborted).toBe(true);
    await expect(promise).resolves.toEqual(expect.objectContaining({ value: null }));
  });
});

describe('queryDatasource — template variable interpolation', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { warnSpy.mockRestore(); jest.restoreAllMocks(); });

  test('Prometheus interpolates query via replaceVars', async () => {
    mockDsType('prometheus');
    mockFetchOk({
      data: { result: [{ metric: {}, value: [0, '5'] }] },
    });
    const replaceVars = jest.fn((v: string) => v.replace('$env', 'prod'));
    const result = await queryDatasource(
      'uid-1',
      'up{env="$env"}',
      undefined,
      undefined,
      replaceVars
    );
    expect(result).toMatchObject({ value: 5 });
    expect(replaceVars).toHaveBeenCalledWith('up{env="$env"}');
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(decodeURIComponent(calledUrl)).toContain('up{env="prod"}');
  });

  test('CloudWatch interpolates namespace', async () => {
    mockDsType('cloudwatch');
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[1], [3]] } }] } },
    });
    const replaceVars = jest.fn((v: string) => v.replace('$region', 'us-east-1'));
    await queryDatasource(
      'uid-1',
      '',
      undefined,
      { namespace: 'AWS/$region', metricName: 'RequestCount' },
      replaceVars
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.queries[0].namespace).toBe('AWS/us-east-1');
  });

  test('CloudWatch interpolates dimension values', async () => {
    mockDsType('cloudwatch');
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[1], [3]] } }] } },
    });
    const replaceVars = jest.fn((v: string) => v.replace('$env', 'prod'));
    await queryDatasource(
      'uid-1',
      '',
      undefined,
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'RequestCount',
        dimensions: { LoadBalancer: 'app/$env-alb/abc' },
      },
      replaceVars
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.queries[0].dimensions.LoadBalancer).toEqual(['app/prod-alb/abc']);
  });

  test('CloudWatch interpolates dimension keys', async () => {
    mockDsType('cloudwatch');
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[1], [3]] } }] } },
    });
    const replaceVars = jest.fn((v: string) => (v === '$dimKey' ? 'Stage' : v));
    await queryDatasource(
      'uid-1',
      '',
      undefined,
      {
        namespace: 'AWS/x',
        metricName: 'y',
        dimensions: { $dimKey: 'static-value' },
      },
      replaceVars
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.queries[0].dimensions).toHaveProperty('Stage');
    expect(body.queries[0].dimensions).not.toHaveProperty('$dimKey');
  });

  test('Infinity interpolates url', async () => {
    mockDsType('yesoreyeram-infinity-datasource');
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[42]] } }] } },
    });
    const replaceVars = jest.fn((v: string) => v.replace('$env', 'prod'));
    await queryDatasource(
      'uid-1',
      '',
      undefined,
      { url: 'https://api/$env/metrics' },
      replaceVars
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.queries[0].url).toBe('https://api/prod/metrics');
  });

  test('Infinity interpolates POST body', async () => {
    mockDsType('yesoreyeram-infinity-datasource');
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[42]] } }] } },
    });
    const replaceVars = jest.fn((v: string) => v.replace('$env', 'prod'));
    await queryDatasource(
      'uid-1',
      '',
      undefined,
      {
        url: 'https://api/x',
        method: 'POST',
        body: '{"env":"$env"}',
      },
      replaceVars
    );
    const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(sent.queries[0].url_options.data).toBe('{"env":"prod"}');
  });

  test('no replaceVars → template tokens pass through unchanged', async () => {
    mockDsType('cloudwatch');
    mockFetchOk({
      results: { A: { frames: [{ data: { values: [[1], [3]] } }] } },
    });
    await queryDatasource(
      'uid-1',
      '',
      undefined,
      { namespace: 'AWS/$env', metricName: 'y' }
      // replaceVars intentionally omitted
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.queries[0].namespace).toBe('AWS/$env');
  });
});
