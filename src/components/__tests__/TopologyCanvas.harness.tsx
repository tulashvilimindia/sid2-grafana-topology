// Shared fixtures + render helper for TopologyCanvas interaction tests.
//
// NOTE: filename is `.harness.tsx` (not `.test.tsx`) so Jest does NOT pick
// it up as a suite. Import directly from this file in any interaction
// suite that needs canvas rendering.

import React from 'react';
import { render } from '@testing-library/react';
import { TopologyCanvas } from '../TopologyCanvas';
import {
  TopologyNode,
  TopologyEdge,
  NodeGroup,
  NodeRuntimeState,
  EdgeRuntimeState,
  DEFAULT_EDGE,
} from '../../types';

// ─── jsdom polyfills ──────────────────────────────────────────────────
//
// TopologyCanvas reads window.matchMedia at mount to detect
// prefers-reduced-motion. jsdom does not provide matchMedia by default,
// so calling it throws. Install a "no" stub so the canvas thinks reduced
// motion is off and renders animations normally.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

// TopologyPanel uses ResizeObserver for the toolbar height. TopologyCanvas
// itself does not directly, but some tests may render via TopologyPanel in
// the future — stub it here so every test file that imports the harness
// gets it for free.
if (typeof (global as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  };
}

// ─── Fixture builders ─────────────────────────────────────────────────

export function buildNode(overrides: Partial<TopologyNode> = {}): TopologyNode {
  return {
    id: 'n-test',
    name: 'test',
    role: '',
    type: 'server',
    metrics: [],
    position: { x: 100, y: 100 },
    compact: false,
    ...overrides,
  };
}

export function buildEdge(overrides: Partial<TopologyEdge> = {}): TopologyEdge {
  return {
    ...(DEFAULT_EDGE as TopologyEdge),
    id: 'e-test',
    sourceId: 'n-a',
    targetId: 'n-b',
    ...overrides,
  };
}

type CanvasProps = React.ComponentProps<typeof TopologyCanvas>;

export function buildCanvasProps(overrides: Partial<CanvasProps> = {}): CanvasProps {
  const nodes: TopologyNode[] = [
    buildNode({ id: 'n-a', name: 'A', position: { x: 50, y: 50 } }),
    buildNode({ id: 'n-b', name: 'B', position: { x: 300, y: 50 } }),
    buildNode({ id: 'n-c', name: 'C', position: { x: 175, y: 200 } }),
  ];
  const edges: TopologyEdge[] = [
    buildEdge({ id: 'e-ab', sourceId: 'n-a', targetId: 'n-b' }),
    buildEdge({ id: 'e-bc', sourceId: 'n-b', targetId: 'n-c' }),
  ];
  const groups: NodeGroup[] = [];
  const nodePositions = new Map<string, { x: number; y: number }>(
    nodes.map((n) => [n.id, n.position])
  );
  const nodeStates = new Map<string, NodeRuntimeState>(
    nodes.map((n) => [
      n.id,
      { nodeId: n.id, status: 'ok', metricValues: {}, expanded: false },
    ])
  );
  const edgeStates = new Map<string, EdgeRuntimeState>(
    edges.map((e) => [
      e.id,
      {
        edgeId: e.id,
        status: 'healthy',
        value: 0,
        formattedLabel: undefined,
        thickness: 2,
        color: '#a3be8c',
        animationSpeed: 0,
      },
    ])
  );
  return {
    nodes,
    edges,
    groups,
    nodePositions,
    nodeStates,
    edgeStates,
    canvasOptions: {
      showGrid: false,
      gridSize: 20,
      snapToGrid: false,
      backgroundColor: 'transparent',
    },
    animationOptions: {
      flowEnabled: false,
      defaultFlowSpeed: 'normal',
      pulseOnCritical: false,
    },
    displayOptions: { showEdgeLabels: true, showNodeStatus: true, maxSummaryMetrics: 4 },
    width: 800,
    height: 600,
    panelId: 1,
    onNodeDrag: jest.fn(),
    onNodeToggle: jest.fn(),
    onNodeDoubleClick: jest.fn(),
    onNodeContextMenu: jest.fn(),
    onEdgeContextMenu: jest.fn(),
    onEdgeClick: jest.fn(),
    onEdgeCreate: jest.fn(),
    isEditMode: false,
    ...overrides,
  };
}

export function renderCanvas(overrides: Partial<CanvasProps> = {}) {
  const props = buildCanvasProps(overrides);
  const result = render(<TopologyCanvas {...props} />);
  return { ...result, props };
}
