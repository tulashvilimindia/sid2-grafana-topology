// Mock module-level dependencies BEFORE importing TopologyPanel.
// The panel pulls in Grafana UI primitives, runtime services, and a
// SVG-heavy canvas — stubbing the heavy pieces lets us test the panel
// shell (toolbar, empty state, health bar, stale pill) in isolation.

jest.mock('@grafana/ui', () => {
  const React = require('react');
  return {
    Icon: ({ name }: { name: string }) => React.createElement('span', {}, name),
    IconName: {},
  };
});

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: jest.fn().mockReturnValue({
    get: jest.fn(),
    getInstanceSettings: jest.fn().mockReturnValue({ type: 'prometheus' }),
  }),
  DataSourcePicker: () => null,
}));

// Stub the canvas — we don't need the real SVG renderer in panel shell tests.
// Extended: also exposes `edgeStates` as JSON + callback-triggering buttons so
// tests can exercise the panel's popup / context-menu / edit-request flows
// without rendering the real SVG canvas.
jest.mock('../TopologyCanvas', () => {
  const React = require('react');
  return {
    TopologyCanvas: (props: {
      nodes: Array<{ id: string }>;
      edges: Array<{ id: string }>;
      groups: unknown[];
      edgeStates?: Map<string, { color: string; status: string }>;
      onNodeToggle?: (id: string) => void;
      onEdgeClick?: (id: string, x: number, y: number) => void;
      onNodeContextMenu?: (id: string, x: number, y: number) => void;
      onNodeDoubleClick?: (id: string) => void;
    }) => {
      const edgeStatesArr = Array.from((props.edgeStates || new Map()).entries()).map(
        ([id, s]) => ({ id, color: s.color, status: s.status })
      );
      const firstNodeId = props.nodes?.[0]?.id;
      const firstEdgeId = props.edges?.[0]?.id;
      return React.createElement(
        'div',
        {
          'data-testid': 'canvas',
          'data-node-count': (props.nodes || []).length,
          'data-edge-count': (props.edges || []).length,
          'data-group-count': (props.groups || []).length,
          'data-edge-states': JSON.stringify(edgeStatesArr),
        },
        firstNodeId &&
          React.createElement(
            'button',
            {
              key: 'click-node',
              'data-testid': 'canvas-trigger-click-node',
              // stopPropagation matches real canvas behavior — otherwise
              // the click bubbles to TopologyPanel's outer onClick=closeAll
              // and cancels the popup we just opened.
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                props.onNodeToggle?.(firstNodeId);
              },
            },
            'click node'
          ),
        firstNodeId &&
          React.createElement(
            'button',
            {
              key: 'ctx-node',
              'data-testid': 'canvas-trigger-ctx-node',
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                props.onNodeContextMenu?.(firstNodeId, 0, 0);
              },
            },
            'ctx node'
          ),
        firstNodeId &&
          React.createElement(
            'button',
            {
              key: 'dbl-node',
              'data-testid': 'canvas-trigger-dbl-node',
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                props.onNodeDoubleClick?.(firstNodeId);
              },
            },
            'dbl node'
          ),
        firstEdgeId &&
          React.createElement(
            'button',
            {
              key: 'click-edge',
              'data-testid': 'canvas-trigger-click-edge',
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                props.onEdgeClick?.(firstEdgeId, 0, 0);
              },
            },
            'click edge'
          )
      );
    },
  };
});

// Mock the self-queries hook so tests can inject failure/success maps
// without patching global fetch. Default return: everything empty.
const selfQueriesMock = jest.fn(() => ({
  data: new Map(),
  isLoading: false,
  failures: new Map(),
}));
jest.mock('../../hooks/useSelfQueries', () => ({
  useSelfQueries: (...args: unknown[]) =>
    (selfQueriesMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

// Stub NodePopup — rendered only when popupNodeId is set, and the popup itself
// is independently tested in NodePopup.test.tsx.
jest.mock('../NodePopup', () => {
  const React = require('react');
  return {
    NodePopup: (props: { node: { name: string } }) =>
      React.createElement('div', { 'data-testid': 'popup' }, props.node.name),
  };
});

// Stub EdgePopup — same rationale as NodePopup stub.
jest.mock('../EdgePopup', () => {
  const React = require('react');
  return {
    EdgePopup: (props: { sourceName: string; targetName: string }) =>
      React.createElement(
        'div',
        { 'data-testid': 'edge-popup' },
        `${props.sourceName}-${props.targetName}`
      ),
  };
});

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TopologyPanel } from '../TopologyPanel';
import { DEFAULT_PANEL_OPTIONS, TopologyPanelOptions } from '../../types';

// Grafana's PanelProps shape — we provide the minimum the panel actually reads.
// Typed as Record<string, unknown> so it's spreadable in `{...makePanelProps()}`.
// The final render call casts via `as never` at the JSX site.
function makePanelProps(optionsOverrides: Partial<TopologyPanelOptions> = {}): Record<string, unknown> {
  return {
    options: { ...DEFAULT_PANEL_OPTIONS, ...optionsOverrides },
    onOptionsChange: jest.fn(),
    data: {
      series: [],
      state: 'Done',
      timeRange: {},
    },
    width: 800,
    height: 600,
    replaceVariables: (s: string) => s,
    id: 1,
    timeRange: {},
    timeZone: 'utc',
    title: 'Test Panel',
    transparent: false,
    fieldConfig: { defaults: {}, overrides: [] },
    renderCounter: 0,
    eventBus: {},
  };
}

// Type-cast helper for the JSX spread — the real PanelProps has many more
// fields we don't need, so we tell TypeScript to trust the shape.
const asPanelProps = (p: Record<string, unknown>) => p as unknown as React.ComponentProps<typeof TopologyPanel>;

beforeEach(() => {
  // Mock fetch globally so useSelfQueries/useAlertRules/useDynamicTargets don't hit real network
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { result: [] } }),
  });
  // Reset selfQueriesMock to empty default each test
  selfQueriesMock.mockImplementation(() => ({
    data: new Map(),
    isLoading: false,
    failures: new Map(),
  }));
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('TopologyPanel — empty state', () => {
  test('shows E2E topology title in toolbar', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    expect(screen.getByText('E2E topology')).toBeInTheDocument();
  });

  test('shows "Load example" button when nodes array is empty', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    expect(screen.getByText('Load example')).toBeInTheDocument();
  });

  test('toolbar has Auto layout and expand/collapse toggle button', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    expect(screen.getByText('Auto layout')).toBeInTheDocument();
    // In the empty state, expandedNodes.size (0) === nodes.length (0) so the button
    // label is the "Collapse all" branch of the ternary. Either is valid evidence
    // the toggle button rendered.
    const toggle = screen.queryByText('Expand all') || screen.queryByText('Collapse all');
    expect(toggle).not.toBeNull();
  });

  test('time travel dropdown has 8 options including Live', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    const select = screen.getByTitle('Time travel: view topology at a past time') as HTMLSelectElement;
    expect(select.options).toHaveLength(8);
    expect(select.options[0].textContent).toBe('Live');
  });

  test('canvas receives empty node/edge/group arrays', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    const canvas = screen.getByTestId('canvas');
    expect(canvas.getAttribute('data-node-count')).toBe('0');
    expect(canvas.getAttribute('data-edge-count')).toBe('0');
    expect(canvas.getAttribute('data-group-count')).toBe('0');
  });

  test('no health bar when topology has no nodes', () => {
    const { container } = render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    expect(container.querySelector('.topology-health-bar')).toBeNull();
  });

  test('no stale pill when no self-query failures', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    expect(screen.queryByText(/stale/)).toBeNull();
  });
});

describe('TopologyPanel — Load example flow', () => {
  test('clicking Load example fires onOptionsChange with example topology', () => {
    const onOptionsChange = jest.fn();
    const props = { ...makePanelProps(), onOptionsChange };
    render(<TopologyPanel {...asPanelProps(props)} />);
    fireEvent.click(screen.getByText('Load example'));
    expect(onOptionsChange).toHaveBeenCalledTimes(1);
    const called = onOptionsChange.mock.calls[0][0];
    expect(Array.isArray(called.nodes)).toBe(true);
    expect(called.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(called.edges)).toBe(true);
    expect(Array.isArray(called.groups)).toBe(true);
  });
});

describe('TopologyPanel — populated state', () => {
  test('Load example button hidden when at least one node exists', () => {
    const props = makePanelProps({
      nodes: [
        {
          id: 'n1',
          name: 'N1',
          role: '',
          type: 'server',
          metrics: [],
          position: { x: 100, y: 100 },
          compact: false,
        },
      ],
    });
    render(<TopologyPanel {...asPanelProps(props)} />);
    expect(screen.queryByText('Load example')).toBeNull();
  });

  test('canvas receives the provided nodes', () => {
    const props = makePanelProps({
      nodes: [
        { id: 'a', name: 'A', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
        { id: 'b', name: 'B', role: '', type: 'database', metrics: [], position: { x: 0, y: 0 }, compact: false },
      ],
    });
    render(<TopologyPanel {...asPanelProps(props)} />);
    const canvas = screen.getByTestId('canvas');
    expect(canvas.getAttribute('data-node-count')).toBe('2');
  });

  test('health bar renders one dot per node type', () => {
    const props = makePanelProps({
      nodes: [
        { id: 'a', name: 'A', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
        { id: 'b', name: 'B', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
        { id: 'c', name: 'C', role: '', type: 'database', metrics: [], position: { x: 0, y: 0 }, compact: false },
      ],
    });
    const { container } = render(<TopologyPanel {...asPanelProps(props)} />);
    const dots = container.querySelectorAll('.topology-health-dot');
    // Should be 2 dots — one per distinct type (server, database)
    expect(dots.length).toBe(2);
  });
});

describe('TopologyPanel — time travel', () => {
  test('changing time travel dropdown updates selection', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    const select = screen.getByTitle('Time travel: view topology at a past time') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '-30' } });
    expect(select.value).toBe('-30');
    // The time banner should appear when timeOffset !== 0
    expect(screen.getByText(/Viewing:/)).toBeInTheDocument();
  });

  test('Back to Live button clears time offset', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    const select = screen.getByTitle('Time travel: view topology at a past time') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '-60' } });
    fireEvent.click(screen.getByText('Back to Live'));
    expect(select.value).toBe('0');
  });
});

describe('TopologyPanel — load example banner', () => {
  test('banner appears after clicking Load example', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    fireEvent.click(screen.getByText('Load example'));
    expect(screen.getByText(/Metrics are visual mocks/)).toBeInTheDocument();
  });

  test('banner dismiss button hides the banner', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    fireEvent.click(screen.getByText('Load example'));
    fireEvent.click(screen.getByLabelText('Dismiss example banner'));
    expect(screen.queryByText(/Metrics are visual mocks/)).not.toBeInTheDocument();
  });
});

// ─── Stale pill (self-query failure indicator) ───────────────────────────
//
// TopologyPanel sums `failures.size` from useSelfQueries and renders a
// "⚠ N stale" pill when any failures exist. Previously only the zero-case
// was asserted — this test exercises the non-zero branch.
describe('TopologyPanel — stale pill', () => {
  test('renders "⚠ N stale" when useSelfQueries returns failures', () => {
    selfQueriesMock.mockImplementation(() => ({
      data: new Map(),
      isLoading: false,
      failures: new Map([['m1', 'http'], ['m2', 'network']]),
    }));
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    expect(screen.getByText(/2 stale/)).toBeInTheDocument();
  });

  test('no stale pill when failures map is empty', () => {
    render(<TopologyPanel {...asPanelProps(makePanelProps())} />);
    expect(screen.queryByText(/ stale/)).toBeNull();
  });
});

// ─── Propagated edge coloring (upstream-of-critical) ─────────────────────
//
// When a downstream node has critical status, TopologyPanel's edgeStates
// memo replaces the edge's color with STATUS_COLORS.degraded via the
// `propagateStatus` helper. Asserted by inspecting the stub canvas's
// serialized `data-edge-states`.
describe('TopologyPanel — propagated edge coloring', () => {
  test('edge pointing to a critical node renders with degraded color', () => {
    const props = makePanelProps({
      nodes: [
        {
          id: 'n-src', name: 'src', role: '', type: 'server', metrics: [], compact: false,
          position: { x: 0, y: 0 },
        },
        {
          id: 'n-tgt', name: 'tgt', role: '', type: 'server', compact: false,
          position: { x: 0, y: 0 },
          metrics: [{
            id: 'm1', label: 'load', datasourceUid: '', query: '',
            format: '${value}', section: 'g', isSummary: true, showSparkline: false,
            thresholds: [
              { value: 0, color: 'green' },
              { value: 70, color: 'yellow' },
              { value: 90, color: 'red' },
            ],
          }],
        },
      ],
      edges: [
        {
          id: 'e-1', sourceId: 'n-src', targetId: 'n-tgt', type: 'traffic',
          thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4,
          thresholds: [{ value: 0, color: 'green' }],
          flowAnimation: false, bidirectional: false,
          anchorSource: 'auto', anchorTarget: 'auto',
          // Give the edge its own metric so calculateEdgeStatus returns
          // 'healthy' (not 'nodata'). Propagation only overrides healthy
          // edges (propagatedEdgeIds ∩ status === 'healthy' → 'degraded').
          metric: { datasourceUid: '', query: '', alias: 'e-1-metric' },
        },
      ],
    });
    // Inject a frame whose refId matches the node-metric id so nodeStates picks
    // up value=95, crosses the red threshold, and marks n-tgt critical.
    // Also inject a frame for the edge metric so its status becomes 'healthy'.
    (props as { data: unknown }).data = {
      series: [
        {
          refId: 'm1',
          fields: [
            { name: 'time', type: 'time', values: [0] },
            { name: 'v', type: 'number', values: [95] },
          ],
        },
        {
          refId: 'e-1',
          fields: [
            { name: 'time', type: 'time', values: [0] },
            { name: 'v', type: 'number', values: [10] },
          ],
        },
      ],
      state: 'Done',
      timeRange: {},
    };
    render(<TopologyPanel {...asPanelProps(props)} />);
    const canvas = screen.getByTestId('canvas');
    const serialized = JSON.parse(canvas.getAttribute('data-edge-states') || '[]') as Array<{
      id: string; color: string; status: string;
    }>;
    const edge = serialized.find((e) => e.id === 'e-1');
    expect(edge).toBeDefined();
    // STATUS_COLORS.degraded === '#bf616a' — propagation override kicked in.
    expect(edge!.color).toBe('#bf616a');
  });
});

// ─── Orphan edge cleanup side effect ─────────────────────────────────────
//
// NodesEditor emits `emitOrphanEdgeCleanup(deletedId)` after a node delete.
// TopologyPanel subscribes and, after a 0-tick defer, filters edges that
// reference the deleted node and fires onOptionsChange. This locks the
// cross-subtree cleanup contract.
describe('TopologyPanel — orphan edge cleanup', () => {
  test('onOrphanEdgeCleanup fires onOptionsChange with filtered edges', async () => {
    const { emitOrphanEdgeCleanup } = await import('../../utils/panelEvents');
    const onOptionsChange = jest.fn();
    const props = {
      ...makePanelProps({
        nodes: [
          { id: 'n-a', name: 'A', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
          { id: 'n-b', name: 'B', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
        ],
        edges: [
          {
            id: 'e-1', sourceId: 'n-a', targetId: 'n-b', type: 'traffic',
            thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4,
            thresholds: [], flowAnimation: false, bidirectional: false,
            anchorSource: 'auto', anchorTarget: 'auto',
          },
          {
            id: 'e-2', sourceId: 'n-b', targetId: 'n-a', type: 'traffic',
            thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4,
            thresholds: [], flowAnimation: false, bidirectional: false,
            anchorSource: 'auto', anchorTarget: 'auto',
          },
        ],
      }),
      onOptionsChange,
    };
    render(<TopologyPanel {...asPanelProps(props)} />);
    // Fire the cleanup signal. TopologyPanel's subscriber defers via
    // setTimeout(0) before calling onOptionsChange.
    await new Promise<void>((resolve) => {
      emitOrphanEdgeCleanup('n-a');
      setTimeout(() => resolve(), 0);
    });
    expect(onOptionsChange).toHaveBeenCalled();
    const lastCall = onOptionsChange.mock.calls.at(-1)![0];
    // Both edges referenced n-a (one as source, one as target), so both removed.
    expect(lastCall.edges).toEqual([]);
  });
});

// ─── Popup / context-menu mutual exclusion ────────────────────────────
//
// Opening one floating UI must close the others. TopologyPanel's handlers
// (handleNodeToggle, handleEdgeClick, handleNodeContextMenu) all explicitly
// null-out the other state slots.
describe('TopologyPanel — popup mutual exclusion', () => {
  function seededProps() {
    return makePanelProps({
      nodes: [{
        id: 'n-a', name: 'Alpha', role: '', type: 'server', metrics: [],
        position: { x: 0, y: 0 }, compact: false,
      }],
      edges: [{
        id: 'e-1', sourceId: 'n-a', targetId: 'n-a', type: 'traffic',
        thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4,
        thresholds: [], flowAnimation: false, bidirectional: false,
        anchorSource: 'auto', anchorTarget: 'auto',
      }],
    });
  }

  test('clicking an edge closes any open node popup', () => {
    render(<TopologyPanel {...asPanelProps(seededProps())} />);
    fireEvent.click(screen.getByTestId('canvas-trigger-click-node'));
    expect(screen.getByTestId('popup')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('canvas-trigger-click-edge'));
    expect(screen.queryByTestId('popup')).toBeNull();
    expect(screen.getByTestId('edge-popup')).toBeInTheDocument();
  });

  test('opening a context menu closes both popups', () => {
    render(<TopologyPanel {...asPanelProps(seededProps())} />);
    fireEvent.click(screen.getByTestId('canvas-trigger-click-node'));
    expect(screen.getByTestId('popup')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('canvas-trigger-ctx-node'));
    expect(screen.queryByTestId('popup')).toBeNull();
  });
});

// ─── Canvas double-click → emitNodeEditRequest ───────────────────────────
//
// handleNodeDoubleClick in TopologyPanel emits the edit-request so the
// sidebar NodesEditor scrolls + expands the card.
describe('TopologyPanel — double-click edit request', () => {
  test('double-click on canvas node emits onNodeEditRequest', async () => {
    const { onNodeEditRequest } = await import('../../utils/panelEvents');
    const received: string[] = [];
    const unsub = onNodeEditRequest((id) => received.push(id));
    try {
      render(<TopologyPanel {...asPanelProps(makePanelProps({
        nodes: [{
          id: 'n-x', name: 'X', role: '', type: 'server', metrics: [],
          position: { x: 0, y: 0 }, compact: false,
        }],
      }))} />);
      fireEvent.click(screen.getByTestId('canvas-trigger-dbl-node'));
      expect(received).toEqual(['n-x']);
    } finally {
      unsub();
    }
  });
});
