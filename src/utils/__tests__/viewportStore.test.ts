import {
  getStoredViewport,
  setStoredViewport,
  clearStoredViewport,
} from '../viewportStore';
import { DEFAULT_VIEWPORT } from '../viewport';

describe('viewportStore', () => {
  afterEach(() => {
    clearStoredViewport(1);
    clearStoredViewport(2);
  });

  test('returns undefined for unknown panel id', () => {
    expect(getStoredViewport(999)).toBeUndefined();
  });

  test('stores and retrieves per panel id', () => {
    setStoredViewport(1, { scale: 2, translateX: 10, translateY: 20 });
    expect(getStoredViewport(1)).toEqual({ scale: 2, translateX: 10, translateY: 20 });
  });

  test('different panel ids do not collide', () => {
    setStoredViewport(1, { scale: 2, translateX: 10, translateY: 20 });
    setStoredViewport(2, { scale: 0.5, translateX: -5, translateY: -5 });
    expect(getStoredViewport(1)).toEqual({ scale: 2, translateX: 10, translateY: 20 });
    expect(getStoredViewport(2)).toEqual({ scale: 0.5, translateX: -5, translateY: -5 });
  });

  test('overwrites on repeated set', () => {
    setStoredViewport(1, DEFAULT_VIEWPORT);
    setStoredViewport(1, { scale: 3, translateX: 100, translateY: 50 });
    expect(getStoredViewport(1)).toEqual({ scale: 3, translateX: 100, translateY: 50 });
  });

  test('clear removes the entry', () => {
    setStoredViewport(1, { scale: 2, translateX: 0, translateY: 0 });
    clearStoredViewport(1);
    expect(getStoredViewport(1)).toBeUndefined();
  });

  test('entries are not auto-evicted by unrelated set/clear activity', () => {
    // Regression guard. Before the TopologyCanvas.tsx cleanup-effect removal,
    // the effect at lines 236-240 fired on every unmount (including
    // edit/view toggle remount) and wiped this store — defeating its
    // cross-remount persistence. Now the store is a pure stable Map and
    // entries only disappear via explicit clear calls.
    setStoredViewport(7, { scale: 3, translateX: 50, translateY: 100 });
    for (let i = 100; i < 150; i++) {
      setStoredViewport(i, { scale: 1, translateX: 0, translateY: 0 });
    }
    expect(getStoredViewport(7)).toEqual({ scale: 3, translateX: 50, translateY: 100 });
    for (let i = 100; i < 150; i++) {
      clearStoredViewport(i);
    }
    expect(getStoredViewport(7)).toEqual({ scale: 3, translateX: 50, translateY: 100 });
    clearStoredViewport(7);
  });
});
