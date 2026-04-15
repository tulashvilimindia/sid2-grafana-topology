import {
  emitNodeClicked,
  onNodeClicked,
  emitNodeEditRequest,
  onNodeEditRequest,
  emitEdgeEditRequest,
  onEdgeEditRequest,
  emitOrphanEdgeCleanup,
  onOrphanEdgeCleanup,
  emitTopologyImport,
  onTopologyImport,
} from '../panelEvents';
import { TopologyPanelOptions } from '../../types';

describe('panelEvents pub/sub', () => {
  test('subscriber receives emitted node id', () => {
    const received: string[] = [];
    const unsub = onNodeClicked((id) => received.push(id));
    emitNodeClicked('n-1');
    emitNodeClicked('n-2');
    unsub();
    expect(received).toEqual(['n-1', 'n-2']);
  });

  test('multiple subscribers all receive events', () => {
    const a: string[] = [];
    const b: string[] = [];
    const unsubA = onNodeClicked((id) => a.push(id));
    const unsubB = onNodeClicked((id) => b.push(id));
    emitNodeClicked('shared');
    unsubA();
    unsubB();
    expect(a).toEqual(['shared']);
    expect(b).toEqual(['shared']);
  });

  test('unsubscribed handler stops receiving events', () => {
    const received: string[] = [];
    const unsub = onNodeClicked((id) => received.push(id));
    emitNodeClicked('first');
    unsub();
    emitNodeClicked('second');
    expect(received).toEqual(['first']);
  });

  test('handler that throws does not break other subscribers', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const received: string[] = [];
    const unsubThrower = onNodeClicked(() => { throw new Error('boom'); });
    const unsubGood = onNodeClicked((id) => received.push(id));
    emitNodeClicked('survivor');
    unsubThrower();
    unsubGood();
    expect(received).toEqual(['survivor']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('zero subscribers is a no-op', () => {
    expect(() => emitNodeClicked('no one listening')).not.toThrow();
  });
});

describe('panelEvents edit-request pub/sub', () => {
  test('subscriber receives emitted edit-request', () => {
    const received: string[] = [];
    const unsub = onNodeEditRequest((id) => received.push(id));
    emitNodeEditRequest('n-edit-1');
    unsub();
    expect(received).toEqual(['n-edit-1']);
  });

  test('click and edit-request events are independent channels', () => {
    const clicks: string[] = [];
    const edits: string[] = [];
    const unsubClick = onNodeClicked((id) => clicks.push(id));
    const unsubEdit = onNodeEditRequest((id) => edits.push(id));
    emitNodeClicked('a');
    emitNodeEditRequest('b');
    unsubClick();
    unsubEdit();
    expect(clicks).toEqual(['a']);
    expect(edits).toEqual(['b']);
  });

  test('edit-request handler that throws does not break other subscribers', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const received: string[] = [];
    const unsubThrower = onNodeEditRequest(() => { throw new Error('boom'); });
    const unsubGood = onNodeEditRequest((id) => received.push(id));
    emitNodeEditRequest('survivor');
    unsubThrower();
    unsubGood();
    expect(received).toEqual(['survivor']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('unsubscribed edit-request handler stops receiving events', () => {
    const received: string[] = [];
    const unsub = onNodeEditRequest((id) => received.push(id));
    emitNodeEditRequest('first');
    unsub();
    emitNodeEditRequest('second');
    expect(received).toEqual(['first']);
  });
});

describe('panelEvents edge-edit-request pub/sub', () => {
  test('subscriber receives the emitted edge id', () => {
    const received: string[] = [];
    const unsub = onEdgeEditRequest((id) => received.push(id));
    emitEdgeEditRequest('e-1');
    unsub();
    expect(received).toEqual(['e-1']);
  });

  test('unsubscribed edge-edit-request handler stops receiving events', () => {
    const received: string[] = [];
    const unsub = onEdgeEditRequest((id) => received.push(id));
    emitEdgeEditRequest('first');
    unsub();
    emitEdgeEditRequest('second');
    expect(received).toEqual(['first']);
  });

  test('edge-edit-request handler that throws does not break other subscribers', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const received: string[] = [];
    const unsubThrower = onEdgeEditRequest(() => { throw new Error('boom'); });
    const unsubGood = onEdgeEditRequest((id) => received.push(id));
    emitEdgeEditRequest('survivor');
    unsubThrower();
    unsubGood();
    expect(received).toEqual(['survivor']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('edge-edit-request is independent from node-edit-request', () => {
    const nodeEdits: string[] = [];
    const edgeEdits: string[] = [];
    const unsubA = onNodeEditRequest((id) => nodeEdits.push(id));
    const unsubB = onEdgeEditRequest((id) => edgeEdits.push(id));
    emitNodeEditRequest('n-1');
    emitEdgeEditRequest('e-1');
    unsubA();
    unsubB();
    expect(nodeEdits).toEqual(['n-1']);
    expect(edgeEdits).toEqual(['e-1']);
  });
});

describe('panelEvents orphan-edge-cleanup pub/sub', () => {
  test('subscriber receives the deleted node id', () => {
    const received: string[] = [];
    const unsub = onOrphanEdgeCleanup((id) => received.push(id));
    emitOrphanEdgeCleanup('n-deleted');
    unsub();
    expect(received).toEqual(['n-deleted']);
  });

  test('all three event channels are independent', () => {
    const clicks: string[] = [];
    const edits: string[] = [];
    const cleanups: string[] = [];
    const unsubA = onNodeClicked((id) => clicks.push(id));
    const unsubB = onNodeEditRequest((id) => edits.push(id));
    const unsubC = onOrphanEdgeCleanup((id) => cleanups.push(id));
    emitNodeClicked('click');
    emitNodeEditRequest('edit');
    emitOrphanEdgeCleanup('cleanup');
    unsubA(); unsubB(); unsubC();
    expect(clicks).toEqual(['click']);
    expect(edits).toEqual(['edit']);
    expect(cleanups).toEqual(['cleanup']);
  });

  test('orphan-cleanup handler that throws does not break other subscribers', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const received: string[] = [];
    const unsubThrower = onOrphanEdgeCleanup(() => { throw new Error('boom'); });
    const unsubGood = onOrphanEdgeCleanup((id) => received.push(id));
    emitOrphanEdgeCleanup('survivor');
    unsubThrower();
    unsubGood();
    expect(received).toEqual(['survivor']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('panelEvents topology-import pub/sub', () => {
  test('subscriber receives the emitted partial payload', () => {
    const received: Array<Partial<TopologyPanelOptions>> = [];
    const unsub = onTopologyImport((payload) => received.push(payload));
    const payload: Partial<TopologyPanelOptions> = {
      nodes: [],
      edges: [],
      canvas: { backgroundColor: '#000', showGrid: false, snapToGrid: false, gridSize: 20 },
    };
    emitTopologyImport(payload);
    unsub();
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(payload);
  });

  test('unsubscribed import handler stops receiving events', () => {
    const received: Array<Partial<TopologyPanelOptions>> = [];
    const unsub = onTopologyImport((payload) => received.push(payload));
    emitTopologyImport({ nodes: [] });
    unsub();
    emitTopologyImport({ edges: [] });
    expect(received).toHaveLength(1);
  });

  test('import handler that throws does not break other subscribers', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const received: Array<Partial<TopologyPanelOptions>> = [];
    const unsubThrower = onTopologyImport(() => { throw new Error('boom'); });
    const unsubGood = onTopologyImport((payload) => received.push(payload));
    emitTopologyImport({ nodes: [] });
    unsubThrower();
    unsubGood();
    expect(received).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('import channel is independent from click/edit/cleanup channels', () => {
    const clicks: string[] = [];
    const imports: Array<Partial<TopologyPanelOptions>> = [];
    const unsubClick = onNodeClicked((id) => clicks.push(id));
    const unsubImport = onTopologyImport((p) => imports.push(p));
    emitNodeClicked('a');
    emitTopologyImport({ nodes: [] });
    unsubClick();
    unsubImport();
    expect(clicks).toEqual(['a']);
    expect(imports).toHaveLength(1);
  });

  // ─── section hint (hybrid click-ops sidebar-redirect) ─────────────────

  test('emitNodeEditRequest without section — handler receives undefined section', () => {
    const handler = jest.fn();
    const unsub = onNodeEditRequest(handler);
    emitNodeEditRequest('n-1');
    unsub();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('n-1', undefined);
  });

  test('emitNodeEditRequest with section — handler receives the section string', () => {
    const handler = jest.fn();
    const unsub = onNodeEditRequest(handler);
    emitNodeEditRequest('n-1', 'alertMatchers');
    unsub();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('n-1', 'alertMatchers');
  });

  test('emitEdgeEditRequest without section — handler receives undefined section', () => {
    const handler = jest.fn();
    const unsub = onEdgeEditRequest(handler);
    emitEdgeEditRequest('e-1');
    unsub();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('e-1', undefined);
  });

  test('emitEdgeEditRequest with section — handler receives the section string', () => {
    const handler = jest.fn();
    const unsub = onEdgeEditRequest(handler);
    emitEdgeEditRequest('e-1', 'thresholds');
    unsub();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('e-1', 'thresholds');
  });
});
