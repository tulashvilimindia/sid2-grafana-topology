import {
  isWorseStatus,
  getAnchorPoint,
  getBezierPath,
  calculateEdgeStatus,
  getEdgeColor,
  calculateThickness,
  calculateFlowSpeed,
  getBezierMidpoint,
  propagateStatus,
  EDGE_TYPE_STYLES,
} from '../edges';
import { ThresholdStep } from '../../types';

describe('isWorseStatus', () => {
  test.each([
    ['critical', 'ok', true],
    ['down', 'critical', true],
    ['warning', 'ok', true],
    ['nodata', 'ok', true],
    ['ok', 'critical', false],
    ['ok', 'ok', false],
    ['warning', 'warning', false],
  ])('isWorseStatus(%s, %s) = %s', (candidate, current, expected) => {
    expect(isWorseStatus(candidate as never, current as never)).toBe(expected);
  });

  test('undefined candidate returns false', () => {
    expect(isWorseStatus(undefined, 'ok')).toBe(false);
  });
});

describe('getAnchorPoint', () => {
  const rect = { x: 100, y: 100, w: 200, h: 80 };

  test('top anchor centers on top edge', () => {
    expect(getAnchorPoint(rect, 'top')).toEqual({ x: 200, y: 100 });
  });

  test('bottom anchor centers on bottom edge', () => {
    expect(getAnchorPoint(rect, 'bottom')).toEqual({ x: 200, y: 180 });
  });

  test('left anchor centers on left edge', () => {
    expect(getAnchorPoint(rect, 'left')).toEqual({ x: 100, y: 140 });
  });

  test('right anchor centers on right edge', () => {
    expect(getAnchorPoint(rect, 'right')).toEqual({ x: 300, y: 140 });
  });

  test('auto anchor picks bottom when target is below', () => {
    const target = { x: 100, y: 300, w: 200, h: 80 };
    expect(getAnchorPoint(rect, 'auto', target)).toEqual({ x: 200, y: 180 });
  });

  test('auto anchor picks top when target is above', () => {
    const target = { x: 100, y: -100, w: 200, h: 80 };
    expect(getAnchorPoint(rect, 'auto', target)).toEqual({ x: 200, y: 100 });
  });

  test('auto anchor picks right when target is to the right', () => {
    const target = { x: 500, y: 100, w: 200, h: 80 };
    expect(getAnchorPoint(rect, 'auto', target)).toEqual({ x: 300, y: 140 });
  });

  test('auto anchor picks left when target is to the left', () => {
    const target = { x: -500, y: 100, w: 200, h: 80 };
    expect(getAnchorPoint(rect, 'auto', target)).toEqual({ x: 100, y: 140 });
  });

  test('auto without target falls back to bottom-center default branch', () => {
    expect(getAnchorPoint(rect, 'auto')).toEqual({ x: 200, y: 180 });
  });
});

describe('getBezierPath', () => {
  test('horizontal flow produces curve through midpoint', () => {
    const path = getBezierPath({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(path).toMatch(/^M0 0 C/);
  });

  test('vertical flow produces curve through midpoint', () => {
    const path = getBezierPath({ x: 0, y: 0 }, { x: 0, y: 100 });
    expect(path).toMatch(/^M0 0 C/);
  });
});

describe('calculateEdgeStatus', () => {
  const thresholds: ThresholdStep[] = [
    { value: 0, color: 'green' },
    { value: 70, color: 'yellow' },
    { value: 90, color: 'red' },
  ];

  test('null value returns nodata', () => {
    expect(calculateEdgeStatus(null, thresholds)).toBe('nodata');
  });

  test('undefined value returns nodata', () => {
    expect(calculateEdgeStatus(undefined as never, thresholds)).toBe('nodata');
  });

  test('below lowest threshold returns healthy (green)', () => {
    expect(calculateEdgeStatus(50, thresholds)).toBe('healthy');
  });

  test('at warning threshold returns saturated (yellow)', () => {
    expect(calculateEdgeStatus(70, thresholds)).toBe('saturated');
  });

  test('at critical threshold returns degraded (red)', () => {
    expect(calculateEdgeStatus(90, thresholds)).toBe('degraded');
  });

  test('above critical threshold returns degraded (red)', () => {
    expect(calculateEdgeStatus(150, thresholds)).toBe('degraded');
  });

  test('empty thresholds defaults to healthy', () => {
    expect(calculateEdgeStatus(42, [])).toBe('healthy');
  });

  test('stateMap green maps to healthy', () => {
    expect(calculateEdgeStatus(1, thresholds, { '1': 'green', '0': 'red' })).toBe('healthy');
  });

  test('stateMap red maps to degraded', () => {
    expect(calculateEdgeStatus(0, thresholds, { '1': 'green', '0': 'red' })).toBe('degraded');
  });

  test('stateMap yellow maps to saturated', () => {
    expect(calculateEdgeStatus(2, thresholds, { '2': 'yellow' })).toBe('saturated');
  });

  test('stateMap precedence: unmatched value falls through to thresholds', () => {
    // Value 150 not in stateMap but exceeds 90 threshold → degraded from thresholds
    expect(calculateEdgeStatus(150, thresholds, { '1': 'green' })).toBe('degraded');
  });

  test('empty stateMap does not short-circuit threshold logic', () => {
    expect(calculateEdgeStatus(50, thresholds, {})).toBe('healthy');
  });
});

describe('getEdgeColor', () => {
  test('returns color for known statuses', () => {
    expect(getEdgeColor('healthy')).toBe('#a3be8c');
    expect(getEdgeColor('saturated')).toBe('#ebcb8b');
    expect(getEdgeColor('degraded')).toBe('#bf616a');
    expect(getEdgeColor('down')).toBe('#bf616a');
    expect(getEdgeColor('nodata')).toBe('#4c566a');
  });
});

describe('calculateThickness', () => {
  const thresholds: ThresholdStep[] = [
    { value: 0, color: 'green' },
    { value: 70, color: 'yellow' },
    { value: 90, color: 'red' },
  ];

  test('null value returns min', () => {
    expect(calculateThickness(null, 'fixed', 1.5, 4, thresholds)).toBe(1.5);
  });

  test('fixed mode always returns min regardless of value', () => {
    expect(calculateThickness(500, 'fixed', 1.5, 4, thresholds)).toBe(1.5);
  });

  test('proportional mode scales between min and max', () => {
    // Threshold max is 90, value 45 = 50% → min + 0.5 * (max - min) = 1.5 + 1.25 = 2.75
    expect(calculateThickness(45, 'proportional', 1.5, 4, thresholds)).toBeCloseTo(2.75, 2);
  });

  test('proportional mode clamps ratio to 1 when value exceeds threshold max', () => {
    expect(calculateThickness(1000, 'proportional', 1.5, 4, thresholds)).toBe(4);
  });

  test('threshold mode steps through tiers', () => {
    // 3 thresholds, step = (4 - 1.5) / 3 ≈ 0.833
    // value 95 is above all thresholds → top step (tiers 3) → min + 3 * step = 4
    expect(calculateThickness(95, 'threshold', 1.5, 4, thresholds)).toBeCloseTo(4, 1);
  });

  test('proportional mode with no thresholds falls back to min (was silent max-clamp)', () => {
    // Previously returned 4 (max) because thresholdMax defaulted to 1 and
    // any value > 1 clamped to max — misleading for unconfigured metrics.
    // Now falls back to fixed-mode behavior and returns min.
    expect(calculateThickness(10, 'proportional', 1.5, 4, [])).toBe(1.5);
    expect(calculateThickness(1000, 'proportional', 1.5, 4, [])).toBe(1.5);
  });
});

describe('calculateFlowSpeed', () => {
  const thresholds: ThresholdStep[] = [{ value: 0, color: 'green' }, { value: 90, color: 'red' }];

  test('none mode returns 0', () => {
    expect(calculateFlowSpeed(50, 'none', thresholds)).toBe(0);
  });

  test('slow mode returns 2.5', () => {
    expect(calculateFlowSpeed(50, 'slow', thresholds)).toBe(2.5);
  });

  test('normal mode returns 1.4', () => {
    expect(calculateFlowSpeed(50, 'normal', thresholds)).toBe(1.4);
  });

  test('fast mode returns 0.6', () => {
    expect(calculateFlowSpeed(50, 'fast', thresholds)).toBe(0.6);
  });

  test('auto mode with null value returns 1.4', () => {
    expect(calculateFlowSpeed(null, 'auto', thresholds)).toBe(1.4);
  });

  test('auto mode scales: 0% traffic → 2.5s (slow)', () => {
    expect(calculateFlowSpeed(0, 'auto', thresholds)).toBeCloseTo(2.5, 2);
  });

  test('auto mode scales: 100% traffic → 0.5s (fast)', () => {
    expect(calculateFlowSpeed(90, 'auto', thresholds)).toBeCloseTo(0.5, 2);
  });

  test('auto mode scales: 50% traffic → ~1.5s', () => {
    expect(calculateFlowSpeed(45, 'auto', thresholds)).toBeCloseTo(1.5, 2);
  });
});

describe('getBezierMidpoint', () => {
  test('returns midpoint x y with -10 y offset for label lift', () => {
    expect(getBezierMidpoint({ x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ x: 50, y: 40 });
  });
});

describe('EDGE_TYPE_STYLES', () => {
  test('traffic edge has no dash', () => {
    expect(EDGE_TYPE_STYLES.traffic).toEqual({ dashArray: '', opacity: 1 });
  });

  test('ha_sync edge has dash pattern', () => {
    expect(EDGE_TYPE_STYLES.ha_sync.dashArray).toBe('6 4');
  });

  test('all 6 edge types are defined', () => {
    expect(Object.keys(EDGE_TYPE_STYLES).sort()).toEqual(
      ['custom', 'failover', 'ha_sync', 'monitor', 'response', 'traffic']
    );
  });
});

describe('propagateStatus', () => {
  const edges = [
    { id: 'e1', sourceId: 'n1', targetId: 'n2' },
    { id: 'e2', sourceId: 'n2', targetId: 'n3' },
    { id: 'e3', sourceId: 'n1', targetId: 'n4' },
  ];

  test('no critical nodes → empty set', () => {
    const statuses = new Map([['n1', 'ok'], ['n2', 'ok'], ['n3', 'ok']] as Array<[string, never]>);
    expect(propagateStatus(statuses, edges).size).toBe(0);
  });

  test('one critical node marks all incoming edges', () => {
    const statuses = new Map([['n1', 'ok'], ['n2', 'ok'], ['n3', 'critical']] as Array<[string, never]>);
    const result = propagateStatus(statuses, edges);
    expect(result.size).toBe(1);
    expect(result.has('e2')).toBe(true);
  });

  test('warning node also propagates (any non-nodata non-unknown)', () => {
    const statuses = new Map([['n2', 'warning']] as Array<[string, never]>);
    const result = propagateStatus(statuses, edges);
    expect(result.has('e1')).toBe(true);
  });

  test('nodata status does NOT propagate', () => {
    const statuses = new Map([['n2', 'nodata']] as Array<[string, never]>);
    expect(propagateStatus(statuses, edges).size).toBe(0);
  });

  test('edge without targetId is skipped', () => {
    const edgesWithOrphan = [{ id: 'e-orphan', sourceId: 'n1' }];
    const statuses = new Map([['n1', 'critical']] as Array<[string, never]>);
    expect(propagateStatus(statuses, edgesWithOrphan).size).toBe(0);
  });
});
