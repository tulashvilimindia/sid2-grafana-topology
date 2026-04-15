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
import { renderCanvas } from './TopologyCanvas.harness';
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
});
