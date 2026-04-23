// Interaction tests for TopologyCanvas — covers the drag, drag-to-connect,
// edge hit-test, and wheel-zoom code paths that live in the 892-LOC
// component. Uses the shared harness in TopologyCanvas.harness.tsx.
//
// jsdom does not provide PointerEvent — fireEvent.pointer* would throw.
// Instead we dispatch plain Events with clientX/clientY/button/shiftKey
// assigned manually. The production handlers read these fields directly
// so they don't care about the event's actual class.

import React from 'react';
import { act, fireEvent } from '@testing-library/react';
import { renderCanvas, buildNode, buildEdge } from './TopologyCanvas.harness';
import { clearStoredViewport } from '../../utils/viewportStore';

// ─── Helpers ──────────────────────────────────────────────────────────

type PointerOpts = {
  clientX?: number;
  clientY?: number;
  button?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
};

// Construct a MouseEvent (jsdom does not implement PointerEvent). React
// reads modifier keys from the native event; MouseEvent's constructor
// options dict correctly propagates shiftKey / ctrlKey / button / clientX.
// This is more reliable than Object.assign-ing onto a plain Event, which
// doesn't always survive React's synthetic event wrapping.
function mouseEvent(type: string, opts: PointerOpts = {}): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
    shiftKey: !!opts.shiftKey,
    ctrlKey: !!opts.ctrlKey,
  });
}

function firePointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  opts: PointerOpts = {}
): Event {
  const ev = mouseEvent(type, opts);
  target.dispatchEvent(ev);
  return ev;
}

// Drag via the document-level listeners that TopologyCanvas attaches to
// document while `dragging` state is non-null. `pointerdown` on the node
// uses React's synthetic event system (fireEvent.pointerDown wraps in
// act); subsequent move/up go through document directly and must be
// wrapped in act() manually so React flushes state updates.
function dragNode(
  nodeEl: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { shift?: boolean } = {}
): void {
  fireEvent.pointerDown(nodeEl, {
    clientX: from.x,
    clientY: from.y,
    button: 0,
    shiftKey: !!opts.shift,
  });
  act(() => {
    firePointer(document, 'pointermove', { clientX: to.x, clientY: to.y });
    firePointer(document, 'pointerup', { clientX: to.x, clientY: to.y });
  });
}

// ─── Test suite ───────────────────────────────────────────────────────

describe('TopologyCanvas interactions', () => {
  beforeEach(() => {
    // Isolate each test from viewportStore state bleed. panelId=1 is the
    // default in the harness.
    clearStoredViewport(1);
  });

  // ─── Drag + click + keyboard ────────────────────────────────────────

  test('node drag updates position via onNodeDrag', () => {
    const { props, getByLabelText } = renderCanvas();
    const nodeA = getByLabelText('A (server): ok');
    dragNode(nodeA, { x: 60, y: 60 }, { x: 150, y: 120 });
    expect(props.onNodeDrag).toHaveBeenCalled();
    const lastCall = (props.onNodeDrag as jest.Mock).mock.calls.at(-1);
    expect(lastCall[0]).toBe('n-a');
    expect(typeof lastCall[1]).toBe('number');
    expect(typeof lastCall[2]).toBe('number');
    // Drag suppressed the click — onNodeToggle should NOT have been called
    expect(props.onNodeToggle).not.toHaveBeenCalled();
  });

  test('click without drag triggers onNodeToggle', () => {
    const { props, getByLabelText } = renderCanvas();
    const nodeA = getByLabelText('A (server): ok');
    fireEvent.click(nodeA);
    expect(props.onNodeToggle).toHaveBeenCalledTimes(1);
    expect((props.onNodeToggle as jest.Mock).mock.calls[0][0]).toBe('n-a');
    expect(props.onNodeDrag).not.toHaveBeenCalled();
  });

  test('keyboard Enter on focused node triggers onNodeToggle', () => {
    const { props, getByLabelText } = renderCanvas();
    const nodeA = getByLabelText('A (server): ok');
    fireEvent.keyDown(nodeA, { key: 'Enter' });
    expect(props.onNodeToggle).toHaveBeenCalledTimes(1);
    expect((props.onNodeToggle as jest.Mock).mock.calls[0][0]).toBe('n-a');
  });

  test('keyboard Space on focused node triggers onNodeToggle', () => {
    const { props, getByLabelText } = renderCanvas();
    const nodeA = getByLabelText('A (server): ok');
    fireEvent.keyDown(nodeA, { key: ' ' });
    expect(props.onNodeToggle).toHaveBeenCalledTimes(1);
    expect((props.onNodeToggle as jest.Mock).mock.calls[0][0]).toBe('n-a');
  });

  // ─── Drag-to-connect ──────────────────────────────────────

  test('Shift+drag in edit mode creates edge via onEdgeCreate', () => {
    const { props, getByLabelText } = renderCanvas({ isEditMode: true });
    const nodeA = getByLabelText('A (server): ok');
    // Shift+pointerdown on A enters connect mode; drop on B's rect.
    // In jsdom, node offsetWidth is 0, so the hit-test falls back to
    // node.width || 180. Node B position is (300, 50) so its hit rect
    // is [300, 50, 480, 140]. Drop at (350, 70) — inside node B.
    fireEvent(nodeA, mouseEvent('pointerdown', {
      clientX: 55, clientY: 55, button: 0, shiftKey: true,
    }));
    act(() => {
      firePointer(document, 'pointermove', { clientX: 350, clientY: 70 });
      firePointer(document, 'pointerup', { clientX: 350, clientY: 70, button: 0 });
    });
    expect(props.onEdgeCreate).toHaveBeenCalledTimes(1);
    expect((props.onEdgeCreate as jest.Mock).mock.calls[0]).toEqual(['n-a', 'n-b']);
  });

  test('Shift+drag in VIEW mode does NOT create an edge', () => {
    const { props, getByLabelText } = renderCanvas({ isEditMode: false });
    const nodeA = getByLabelText('A (server): ok');
    fireEvent(nodeA, mouseEvent('pointerdown', {
      clientX: 55, clientY: 55, button: 0, shiftKey: true,
    }));
    act(() => {
      firePointer(document, 'pointermove', { clientX: 350, clientY: 70 });
      firePointer(document, 'pointerup', { clientX: 350, clientY: 70, button: 0 });
    });
    expect(props.onEdgeCreate).not.toHaveBeenCalled();
  });

  test('Escape during connect gesture cancels without onEdgeCreate', () => {
    const { props, getByLabelText } = renderCanvas({ isEditMode: true });
    const nodeA = getByLabelText('A (server): ok');
    fireEvent(nodeA, mouseEvent('pointerdown', {
      clientX: 55, clientY: 55, button: 0, shiftKey: true,
    }));
    // Cancel via Escape on document — connect effect listens for it
    fireEvent.keyDown(document, { key: 'Escape' });
    // Even if pointerup arrives, listeners are already gone
    act(() => {
      firePointer(document, 'pointerup', { clientX: 350, clientY: 70, button: 0 });
    });
    expect(props.onEdgeCreate).not.toHaveBeenCalled();
  });

  // ─── Edge hit-test overlay ──────────────────────────────────────────

  test('edge click fires onEdgeClick with client coordinates', () => {
    const { props, getByTestId } = renderCanvas();
    const edgeAB = getByTestId('edge-hit-e-ab');
    fireEvent.click(edgeAB, { clientX: 200, clientY: 50 });
    expect(props.onEdgeClick).toHaveBeenCalledTimes(1);
    const [edgeId, x, y] = (props.onEdgeClick as jest.Mock).mock.calls[0];
    expect(edgeId).toBe('e-ab');
    expect(x).toBe(200);
    expect(y).toBe(50);
  });

  test('edge contextmenu fires onEdgeContextMenu with client coordinates', () => {
    const { props, getByTestId } = renderCanvas();
    const edgeAB = getByTestId('edge-hit-e-ab');
    fireEvent.contextMenu(edgeAB, { clientX: 200, clientY: 50 });
    expect(props.onEdgeContextMenu).toHaveBeenCalledTimes(1);
    const [edgeId, x, y] = (props.onEdgeContextMenu as jest.Mock).mock.calls[0];
    expect(edgeId).toBe('e-ab');
    expect(x).toBe(200);
    expect(y).toBe(50);
  });

  // ─── Wheel zoom ─────────────────────────────────────────────────────

  test('wheel on canvas updates the viewport transform', () => {
    const { container } = renderCanvas();
    // The outer canvas div holds the wheel listener; the inner transform
    // div has the style we inspect.
    const canvasDiv = container.querySelector('.topology-canvas');
    expect(canvasDiv).not.toBeNull();
    const transformWrapper = canvasDiv!.querySelector<HTMLElement>(':scope > div');
    expect(transformWrapper).not.toBeNull();
    const initialTransform = transformWrapper!.style.transform;

    // Wheel listener is attached via addEventListener (not React onWheel)
    // with { passive: false }, so we dispatch a native-shaped Event.
    // Wrap in act() so React flushes the setViewport state update.
    act(() => {
      const wheelEv = new Event('wheel', { bubbles: true, cancelable: true });
      Object.assign(wheelEv, { deltaY: -100, clientX: 400, clientY: 300 });
      canvasDiv!.dispatchEvent(wheelEv);
    });

    const nextTransform = transformWrapper!.style.transform;
    expect(nextTransform).not.toBe(initialTransform);
  });

  // ─── Edge hover dim ─────────────────────────────────────────────────
  //
  // When any edge is hovered, every other edge's base path fades to
  // opacity 0.2 (state: hoveredEdgeId). The visual layer uses the inner
  // `<path>` of each `<g>`; opacity is passed as a numeric prop which
  // renders to the `opacity` SVG attribute. mouseleave clears it.
  describe('edge hover dim', () => {
    test('mouseenter on one edge dims siblings', () => {
      const { container, getByTestId } = renderCanvas();
      const hit = getByTestId('edge-hit-e-ab');
      fireEvent.mouseEnter(hit);
      // Visual layer is the first SVG; each edge is a <g> with a base <path>.
      const visualPaths = container
        .querySelectorAll<SVGSVGElement>('svg')[0]
        .querySelectorAll<SVGPathElement>('g > path');
      // First <g> is edge e-ab (hovered), second is e-bc (sibling).
      expect(visualPaths[0].getAttribute('opacity')).toBe('1');
      expect(visualPaths[1].getAttribute('opacity')).toBe('0.2');
    });

    test('mouseleave clears dim state', () => {
      const { container, getByTestId } = renderCanvas();
      const hit = getByTestId('edge-hit-e-ab');
      fireEvent.mouseEnter(hit);
      fireEvent.mouseLeave(hit);
      const visualPaths = container
        .querySelectorAll<SVGSVGElement>('svg')[0]
        .querySelectorAll<SVGPathElement>('g > path');
      expect(visualPaths[0].getAttribute('opacity')).toBe('1');
      expect(visualPaths[1].getAttribute('opacity')).toBe('1');
    });
  });

  // ─── Parallel edge perpendicular offset ─────────────────────────────
  //
  // Two edges between the same node pair should spread via the
  // perpendicular-normal math at TopologyCanvas.tsx:485-493 so they
  // don't overlap. Asserted by checking the two paths have different
  // `d` attributes.
  describe('parallel edges', () => {
    test('two edges n-a→n-b render with different bezier d attributes', () => {
      const nodes = [
        buildNode({ id: 'n-a', name: 'A', position: { x: 50, y: 50 } }),
        buildNode({ id: 'n-b', name: 'B', position: { x: 300, y: 50 } }),
      ];
      const edges = [
        buildEdge({ id: 'e-1', sourceId: 'n-a', targetId: 'n-b' }),
        buildEdge({ id: 'e-2', sourceId: 'n-a', targetId: 'n-b' }),
      ];
      const nodePositions = new Map<string, { x: number; y: number }>(
        nodes.map((n) => [n.id, n.position])
      );
      const nodeStates = new Map(
        nodes.map((n) => [n.id, { nodeId: n.id, status: 'ok' as const, metricValues: {}, expanded: false }])
      );
      const edgeStates = new Map(
        edges.map((e) => [
          e.id,
          {
            edgeId: e.id,
            status: 'healthy' as const,
            value: 0,
            formattedLabel: undefined,
            thickness: 2,
            color: '#a3be8c',
            animationSpeed: 0,
          },
        ])
      );
      const { container } = renderCanvas({ nodes, edges, nodePositions, nodeStates, edgeStates });
      const visualPaths = container
        .querySelectorAll<SVGSVGElement>('svg')[0]
        .querySelectorAll<SVGPathElement>('g > path');
      expect(visualPaths.length).toBeGreaterThanOrEqual(2);
      expect(visualPaths[0].getAttribute('d')).not.toBe(visualPaths[1].getAttribute('d'));
    });
  });

  // ─── Auto fit-to-view on first render ───────────────────────────────
  //
  // The effect at TopologyCanvas.tsx:297-307 schedules a fit-to-view
  // 100ms after nodes first appear (prevNodeCountRef went 0→N with no
  // stored viewport). Uses fake timers to avoid a real 100ms wait.
  describe('auto fit-to-view', () => {
    test('schedules fit-to-view 100ms after nodes mount', () => {
      jest.useFakeTimers();
      try {
        const { container } = renderCanvas();
        const wrapper = container
          .querySelector('.topology-canvas')!
          .querySelector<HTMLElement>(':scope > div')!;
        // Before timeout: viewport is still default (identity transform).
        expect(wrapper.style.transform).toBe('translate(0px, 0px) scale(1)');
        act(() => {
          jest.advanceTimersByTime(100);
        });
        // After timeout: fitToView has run and mutated the transform.
        expect(wrapper.style.transform).not.toBe('translate(0px, 0px) scale(1)');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ─── Pan gestures ───────────────────────────────────────────────────
  //
  // Two entry points at TopologyCanvas.tsx:260-267: middle-mouse-button
  // (button=1) and Ctrl+left-click (button=0, ctrlKey=true). Both
  // start a pan gesture that updates viewport.translate on pointermove.
  describe('pan gestures', () => {
    // pointermove + pointerup fire in the same act(). Prior to the fix at
    // TopologyCanvas.tsx:264-270 (snapshot panStartRef.current *before*
    // setViewport), this sequence crashed because React 18 batching flushed
    // the setViewport updater after handleUp had already nulled the ref.
    // The post-fix updater closes over primitives so it's safe.
    test('middle-button drag updates translate and survives pointerup in-batch', () => {
      const { container } = renderCanvas();
      const canvasDiv = container.querySelector('.topology-canvas') as HTMLElement;
      const wrapper = canvasDiv.querySelector<HTMLElement>(':scope > div')!;
      const before = wrapper.style.transform;
      // Use the MouseEvent helper because jsdom's fireEvent.pointerDown
      // does not reliably thread `button` through React's synthetic events.
      fireEvent(canvasDiv, mouseEvent('pointerdown', { clientX: 100, clientY: 100, button: 1 }));
      act(() => {
        firePointer(document, 'pointermove', { clientX: 150, clientY: 125 });
        firePointer(document, 'pointerup', { clientX: 150, clientY: 125 });
      });
      expect(wrapper.style.transform).not.toBe(before);
    });

    test('Ctrl+left-drag updates translate and survives pointerup in-batch', () => {
      const { container } = renderCanvas();
      const canvasDiv = container.querySelector('.topology-canvas') as HTMLElement;
      const wrapper = canvasDiv.querySelector<HTMLElement>(':scope > div')!;
      const before = wrapper.style.transform;
      fireEvent(
        canvasDiv,
        mouseEvent('pointerdown', { clientX: 100, clientY: 100, button: 0, ctrlKey: true })
      );
      act(() => {
        firePointer(document, 'pointermove', { clientX: 140, clientY: 120 });
        firePointer(document, 'pointerup', { clientX: 140, clientY: 120 });
      });
      expect(wrapper.style.transform).not.toBe(before);
    });
  });

  // ─── Zoom controls overlay ──────────────────────────────────────────
  describe('zoom controls', () => {
    test('Fit button updates viewport to fit nodes', () => {
      const { container, getByTitle } = renderCanvas();
      const wrapper = container
        .querySelector('.topology-canvas')!
        .querySelector<HTMLElement>(':scope > div')!;
      fireEvent.click(getByTitle('Fit to view'));
      // Fit recalculates from the 3 harness nodes — non-identity transform.
      expect(wrapper.style.transform).not.toBe('translate(0px, 0px) scale(1)');
    });

    test('1:1 button resets viewport to identity', () => {
      const { container, getByTitle } = renderCanvas();
      const canvasDiv = container.querySelector('.topology-canvas') as HTMLElement;
      const wrapper = canvasDiv.querySelector<HTMLElement>(':scope > div')!;
      // First zoom in via wheel so there's something to reset.
      act(() => {
        const wheelEv = new Event('wheel', { bubbles: true, cancelable: true });
        Object.assign(wheelEv, { deltaY: -300, clientX: 400, clientY: 300 });
        canvasDiv.dispatchEvent(wheelEv);
      });
      expect(wrapper.style.transform).not.toBe('translate(0px, 0px) scale(1)');
      fireEvent.click(getByTitle('Reset zoom'));
      expect(wrapper.style.transform).toBe('translate(0px, 0px) scale(1)');
    });
  });

  // ─── Viewport persistence across remount ────────────────────────────
  //
  // Regression for the deleted cleanup effect at TopologyCanvas.tsx:236-240.
  // That effect called clearStoredViewport(panelId) on every unmount, which
  // defeated the whole purpose of viewportStore for the edit↔view remount
  // case. With the effect gone, zoom survives.
  test('viewport state survives unmount + remount for same panelId', () => {
    const panelId = 42;
    clearStoredViewport(panelId);
    const first = renderCanvas({ panelId });
    const firstCanvas = first.container.querySelector('.topology-canvas')!;
    const firstWrapper = firstCanvas.querySelector<HTMLElement>(':scope > div')!;

    act(() => {
      const wheelEv = new Event('wheel', { bubbles: true, cancelable: true });
      Object.assign(wheelEv, { deltaY: -200, clientX: 400, clientY: 300 });
      firstCanvas.dispatchEvent(wheelEv);
    });
    const zoomedTransform = firstWrapper.style.transform;
    expect(zoomedTransform).not.toBe('translate(0px, 0px) scale(1)');

    first.unmount();

    const second = renderCanvas({ panelId });
    const secondWrapper = second.container
      .querySelector('.topology-canvas')!
      .querySelector<HTMLElement>(':scope > div')!;
    expect(secondWrapper.style.transform).toBe(zoomedTransform);
    second.unmount();
    clearStoredViewport(panelId);
  });
});
