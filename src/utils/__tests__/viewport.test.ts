import { clamp, fitToView, zoomAtPoint, DEFAULT_VIEWPORT } from '../viewport';

describe('clamp', () => {
  test('within range returns value', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  test('below min returns min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  test('above max returns max', () => {
    expect(clamp(50, 0, 10)).toBe(10);
  });

  test('equal to min/max returns that value', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('DEFAULT_VIEWPORT', () => {
  test('is identity: scale 1, no translate', () => {
    expect(DEFAULT_VIEWPORT).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  });
});

describe('fitToView', () => {
  const widths = new Map([['a', 180], ['b', 180]]);

  test('empty positions returns default viewport', () => {
    expect(fitToView(new Map(), new Map(), 800, 600)).toEqual(DEFAULT_VIEWPORT);
  });

  test('computes scale to fit nodes within canvas', () => {
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 500, y: 400 }],
    ]);
    const vp = fitToView(positions, widths, 800, 600, 40);
    expect(vp.scale).toBeGreaterThan(0);
    expect(vp.scale).toBeLessThanOrEqual(2.0);
  });

  test('clamps scale to max 2.0 for very small topologies', () => {
    const positions = new Map([['a', { x: 0, y: 0 }]]);
    const vp = fitToView(positions, widths, 800, 600, 40);
    expect(vp.scale).toBeLessThanOrEqual(2.0);
  });

  test('clamps scale to min 0.2 for very large topologies', () => {
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 10000, y: 10000 }],
    ]);
    const vp = fitToView(positions, widths, 800, 600, 40);
    expect(vp.scale).toBeGreaterThanOrEqual(0.2);
  });
});

describe('zoomAtPoint', () => {
  test('zoom in (negative delta) increases scale', () => {
    const result = zoomAtPoint({ scale: 1, translateX: 0, translateY: 0 }, -100, 400, 300);
    expect(result.scale).toBeGreaterThan(1);
  });

  test('zoom out (positive delta) decreases scale', () => {
    const result = zoomAtPoint({ scale: 1, translateX: 0, translateY: 0 }, 100, 400, 300);
    expect(result.scale).toBeLessThan(1);
  });

  test('scale clamps to 3.0 max', () => {
    const result = zoomAtPoint({ scale: 2.9, translateX: 0, translateY: 0 }, -1000, 400, 300);
    expect(result.scale).toBeLessThanOrEqual(3.0);
  });

  test('scale clamps to 0.2 min', () => {
    const result = zoomAtPoint({ scale: 0.3, translateX: 0, translateY: 0 }, 1000, 400, 300);
    expect(result.scale).toBeGreaterThanOrEqual(0.2);
  });

  test('cursor position stays fixed when zooming', () => {
    // At scale 1, cursor (400, 300), translate (0, 0) — world point at cursor is (400, 300).
    // After zoom in (delta=-100), the same world point should still appear under cursor.
    const cursorX = 400;
    const cursorY = 300;
    const before = { scale: 1, translateX: 0, translateY: 0 };
    const after = zoomAtPoint(before, -100, cursorX, cursorY);
    // World coords under cursor BEFORE: worldX = (cursorX - tx) / scale = 400
    // World coords under cursor AFTER: worldX = (cursorX - after.tx) / after.scale
    const worldAfterX = (cursorX - after.translateX) / after.scale;
    const worldAfterY = (cursorY - after.translateY) / after.scale;
    expect(worldAfterX).toBeCloseTo(400, 1);
    expect(worldAfterY).toBeCloseTo(300, 1);
  });
});
