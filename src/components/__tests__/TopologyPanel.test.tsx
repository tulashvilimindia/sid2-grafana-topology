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
jest.mock('../TopologyCanvas', () => {
  const React = require('react');
  return {
    TopologyCanvas: (props: { nodes: unknown[]; edges: unknown[]; groups: unknown[] }) =>
      React.createElement('div', {
        'data-testid': 'canvas',
        'data-node-count': (props.nodes || []).length,
        'data-edge-count': (props.edges || []).length,
        'data-group-count': (props.groups || []).length,
      }),
  };
});

// Stub NodePopup — rendered only when popupNodeId is set, and the popup itself
// is independently tested in NodePopup.test.tsx.
jest.mock('../NodePopup', () => {
  const React = require('react');
  return {
    NodePopup: (props: { node: { name: string } }) =>
      React.createElement('div', { 'data-testid': 'popup' }, props.node.name),
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
