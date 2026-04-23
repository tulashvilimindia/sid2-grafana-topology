import { fetchAlertRules, matchAlertsToNode } from '../alertRules';
import { FiringAlert } from '../../types';

// ─── Helpers to build a mock fetch ───

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

function mockFetchNetworkError(error: Error): void {
  (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(error);
}

describe('fetchAlertRules', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('parses firing alerts from a successful response', async () => {
    mockFetchOk({
      status: 'success',
      data: {
        groups: [
          {
            name: 'g1',
            rules: [
              {
                name: 'HighCPU',
                state: 'firing',
                alerts: [
                  { state: 'firing', labels: { instance: 'web-01' }, activeAt: '2026-04-14T12:00:00Z' },
                ],
              },
            ],
          },
        ],
      },
    });
    const result = await fetchAlertRules();
    expect(result.error).toBeUndefined();
    expect(result.alerts.length).toBe(1);
    expect(result.alerts[0]).toMatchObject({
      ruleName: 'HighCPU',
      state: 'firing',
      labels: { instance: 'web-01' },
    });
  });

  test('flattens both firing and pending alerts, skips inactive', async () => {
    mockFetchOk({
      status: 'success',
      data: {
        groups: [
          {
            name: 'g1',
            rules: [
              {
                name: 'R1',
                state: 'firing',
                alerts: [
                  { state: 'firing', labels: { k: 'v1' } },
                  { state: 'pending', labels: { k: 'v2' } },
                  { state: 'inactive', labels: { k: 'v3' } },
                ],
              },
            ],
          },
        ],
      },
    });
    const result = await fetchAlertRules();
    expect(result.alerts.length).toBe(2);
    expect(result.alerts.map((a) => a.state).sort()).toEqual(['firing', 'pending']);
  });

  test('merges rule-level and instance-level annotations (instance wins)', async () => {
    mockFetchOk({
      status: 'success',
      data: {
        groups: [
          {
            name: 'g1',
            rules: [
              {
                name: 'R',
                state: 'firing',
                annotations: { summary: 'rule summary', runbook_url: 'https://wiki/r' },
                alerts: [
                  {
                    state: 'firing',
                    labels: {},
                    annotations: { summary: 'instance override' },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const result = await fetchAlertRules();
    expect(result.alerts[0].annotations).toEqual({
      summary: 'instance override',
      runbook_url: 'https://wiki/r',
    });
  });

  test('captures rule uid when present', async () => {
    mockFetchOk({
      status: 'success',
      data: {
        groups: [
          {
            name: 'g1',
            rules: [
              {
                name: 'R',
                state: 'firing',
                uid: 'abc-123',
                alerts: [{ state: 'firing', labels: {} }],
              },
            ],
          },
        ],
      },
    });
    const result = await fetchAlertRules();
    expect(result.alerts[0].ruleUid).toBe('abc-123');
  });

  test('omits ruleUid when rule has no uid', async () => {
    mockFetchOk({
      status: 'success',
      data: {
        groups: [{ name: 'g1', rules: [{ name: 'R', state: 'firing', alerts: [{ state: 'firing', labels: {} }] }] }],
      },
    });
    const result = await fetchAlertRules();
    expect(result.alerts[0].ruleUid).toBeUndefined();
  });

  test('http error returns error http', async () => {
    mockFetchError(502);
    const result = await fetchAlertRules();
    expect(result.error).toBe('http');
    expect(result.alerts).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('parse error on non-success status', async () => {
    mockFetchOk({ status: 'error' });
    const result = await fetchAlertRules();
    expect(result.error).toBe('parse');
  });

  test('network error returns error network', async () => {
    mockFetchNetworkError(new Error('connection refused'));
    const result = await fetchAlertRules();
    expect(result.error).toBe('network');
    expect(warnSpy).toHaveBeenCalled();
  });

  test('AbortError is rethrown, not swallowed', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    mockFetchNetworkError(abortError);
    await expect(fetchAlertRules()).rejects.toThrow('aborted');
  });

  test('empty groups returns empty alerts', async () => {
    mockFetchOk({ status: 'success', data: { groups: [] } });
    const result = await fetchAlertRules();
    expect(result.alerts).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  test('rule without alerts[] is skipped cleanly (does not throw)', async () => {
    // Grafana occasionally returns rules whose `alerts` is undefined (e.g.
    // a rule that has never fired). The iteration must skip these instead
    // of throwing on the .alerts.length read.
    mockFetchOk({
      status: 'success',
      data: {
        groups: [
          {
            name: 'g1',
            rules: [
              { name: 'Never fired', state: 'inactive' }, // alerts undefined
              { name: 'Has firing', state: 'firing', alerts: [{ state: 'firing', labels: { k: 'v' } }] },
            ],
          },
        ],
      },
    });
    const result = await fetchAlertRules();
    expect(result.error).toBeUndefined();
    expect(result.alerts.length).toBe(1);
    expect(result.alerts[0].ruleName).toBe('Has firing');
  });

  test('group without rules[] is skipped cleanly', async () => {
    mockFetchOk({
      status: 'success',
      data: {
        groups: [
          { name: 'g1' }, // no rules field
          { name: 'g2', rules: [{ name: 'R', state: 'firing', alerts: [{ state: 'firing', labels: {} }] }] },
        ],
      },
    });
    const result = await fetchAlertRules();
    expect(result.alerts.length).toBe(1);
  });
});

describe('matchAlertsToNode', () => {
  const alerts: FiringAlert[] = [
    { ruleName: 'R1', state: 'firing', labels: { instance: 'web-01', env: 'prod' } },
    { ruleName: 'R2', state: 'pending', labels: { instance: 'web-02', env: 'prod' } },
    { ruleName: 'R3', state: 'firing', labels: { instance: 'web-03', env: 'staging' } },
  ];

  test('undefined matchers returns empty', () => {
    expect(matchAlertsToNode(alerts, undefined)).toEqual([]);
  });

  test('empty matchers returns empty (opt-in only)', () => {
    expect(matchAlertsToNode(alerts, {})).toEqual([]);
  });

  test('single-key match filters correctly', () => {
    const result = matchAlertsToNode(alerts, { instance: 'web-01' });
    expect(result.length).toBe(1);
    expect(result[0].ruleName).toBe('R1');
  });

  test('multi-key match requires ALL labels to match', () => {
    const result = matchAlertsToNode(alerts, { env: 'prod' });
    expect(result.length).toBe(2);
  });

  test('mismatched value excludes the alert', () => {
    const result = matchAlertsToNode(alerts, { instance: 'web-01', env: 'staging' });
    expect(result).toEqual([]);
  });

  test('key missing from labels excludes the alert', () => {
    const result = matchAlertsToNode(alerts, { nonexistent: 'x' });
    expect(result).toEqual([]);
  });
});
