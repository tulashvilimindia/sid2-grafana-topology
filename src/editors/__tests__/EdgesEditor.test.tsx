// ─── Mocks ────────────────────────────────────────────────────────────
//
// EdgesEditor is the simpler sibling of NodesEditor (no BulkImport, no
// JSON import/export). Stub @grafana/ui + EdgeCard so tests exercise the
// list-level behavior: filter, CRUD, and the onEdgeEditRequest
// subscription that expands + section-hints the matching card.

jest.mock('@grafana/ui', () => {
  const React = require('react');
  return {
    Button: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
      React.createElement('button', { ...props, type: 'button' }, props.children),
    Input: (props: {
      value?: unknown;
      onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
      placeholder?: string;
      prefix?: React.ReactNode;
    }) =>
      React.createElement('input', {
        type: 'text',
        value: (props.value as string) ?? '',
        onChange: props.onChange,
        placeholder: props.placeholder,
      }),
  };
});

// Stub EdgeCard — its own behavior is covered by EdgeCard.test.tsx.
// The stub exposes the isOpen and sectionHint props as data attributes
// so the subscription tests can assert that EdgesEditor forwarded them.
jest.mock('../components/EdgeCard', () => ({
  EdgeCard: ({
    edge, isOpen, sectionHint, onDelete, onDuplicate,
  }: {
    edge: { id: string; sourceId: string; targetId?: string };
    isOpen: boolean;
    sectionHint?: string;
    onDelete: () => void;
    onDuplicate?: () => void;
  }) => {
    const React = require('react');
    return React.createElement(
      'div',
      {
        'data-testid': `edge-card-${edge.id}`,
        'data-is-open': String(!!isOpen),
        'data-section-hint': sectionHint ?? '',
      },
      React.createElement('span', {}, `${edge.sourceId}→${edge.targetId ?? '?'}`),
      React.createElement('button', { type: 'button', onClick: onDelete, 'data-testid': `delete-${edge.id}` }, 'delete'),
      onDuplicate &&
        React.createElement('button', { type: 'button', onClick: onDuplicate, 'data-testid': `duplicate-${edge.id}` }, 'duplicate')
    );
  },
}));

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { EdgesEditor } from '../EdgesEditor';
import {
  TopologyEdge,
  TopologyNode,
  TopologyPanelOptions,
  DEFAULT_PANEL_OPTIONS,
  DEFAULT_EDGE,
} from '../../types';
import { emitEdgeEditRequest } from '../../utils/panelEvents';

const NODES: TopologyNode[] = [
  { id: 'n-a', name: 'Alpha', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
  { id: 'n-b', name: 'Beta', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
  { id: 'n-c', name: 'Gamma', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
];

function makeEdge(overrides: Partial<TopologyEdge> = {}): TopologyEdge {
  return {
    ...(DEFAULT_EDGE as TopologyEdge),
    id: 'e-1',
    sourceId: 'n-a',
    targetId: 'n-b',
    type: 'traffic',
    ...overrides,
  };
}

function renderEdgesEditor(edges: TopologyEdge[] = []) {
  const onChange = jest.fn();
  const context = {
    options: { ...DEFAULT_PANEL_OPTIONS, nodes: NODES } as TopologyPanelOptions,
  };
  const result = render(
    <EdgesEditor
      value={edges}
      onChange={onChange}
      context={context as never}
      item={{} as never}
    />
  );
  return { ...result, onChange };
}

// ─── List CRUD ────────────────────────────────────────────────────────

describe('EdgesEditor — list CRUD', () => {
  test('empty state renders instructional text', () => {
    renderEdgesEditor([]);
    expect(screen.getByText(/No relationships defined/)).toBeInTheDocument();
  });

  test('Add seeds a new edge from DEFAULT_EDGE with first two nodes as source+target', () => {
    const { onChange } = renderEdgesEditor([]);
    fireEvent.click(screen.getByText('Add'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as TopologyEdge[];
    expect(next).toHaveLength(1);
    expect(next[0].sourceId).toBe('n-a');
    expect(next[0].targetId).toBe('n-b');
    // DEFAULT_EDGE fields come through untouched.
    expect(next[0].type).toBe(DEFAULT_EDGE.type);
    expect(next[0].thicknessMode).toBe(DEFAULT_EDGE.thicknessMode);
    expect(next[0].bidirectional).toBe(false);
    expect(next[0].id).toMatch(/^e-/);
  });

  test('Add in a topology with zero nodes seeds an edge with empty source/target', () => {
    // No nodes → source and target fall back to ''.
    const onChange = jest.fn();
    render(
      <EdgesEditor
        value={[]}
        onChange={onChange}
        context={{
          options: { ...DEFAULT_PANEL_OPTIONS, nodes: [] } as TopologyPanelOptions,
        } as never}
        item={{} as never}
      />
    );
    fireEvent.click(screen.getByText('Add'));
    const next = onChange.mock.calls[0][0] as TopologyEdge[];
    expect(next[0].sourceId).toBe('');
    expect(next[0].targetId).toBe('');
  });

  test('Delete removes only the matching edge', () => {
    const { onChange } = renderEdgesEditor([
      makeEdge({ id: 'e-1', sourceId: 'n-a', targetId: 'n-b' }),
      makeEdge({ id: 'e-2', sourceId: 'n-b', targetId: 'n-c' }),
    ]);
    fireEvent.click(screen.getByTestId('delete-e-1'));
    const updated = onChange.mock.calls.at(-1)![0] as TopologyEdge[];
    expect(updated.map((e) => e.id)).toEqual(['e-2']);
  });

  test('Duplicate appends a new edge with regenerated id, everything else copied', () => {
    const { onChange } = renderEdgesEditor([
      makeEdge({ id: 'e-1', sourceId: 'n-a', targetId: 'n-b', type: 'ha_sync' }),
    ]);
    fireEvent.click(screen.getByTestId('duplicate-e-1'));
    const updated = onChange.mock.calls.at(-1)![0] as TopologyEdge[];
    expect(updated).toHaveLength(2);
    expect(updated[1].id).not.toBe('e-1');
    expect(updated[1].id).toMatch(/^e-/);
    expect(updated[1].sourceId).toBe('n-a');
    expect(updated[1].targetId).toBe('n-b');
    expect(updated[1].type).toBe('ha_sync');
  });
});

// ─── Filter ────────────────────────────────────────────────────────────

describe('EdgesEditor — filter', () => {
  const edges: TopologyEdge[] = [
    makeEdge({ id: 'e-traffic', sourceId: 'n-a', targetId: 'n-b', type: 'traffic' }),
    makeEdge({ id: 'e-ha', sourceId: 'n-b', targetId: 'n-c', type: 'ha_sync' }),
    makeEdge({ id: 'e-failover', sourceId: 'n-a', targetId: 'n-c', type: 'failover' }),
    makeEdge({ id: 'e-monitor', sourceId: 'n-c', targetId: 'n-a', type: 'monitor' }),
  ];

  test('filter input only renders when edge count exceeds 3', () => {
    const three = edges.slice(0, 3);
    const { rerender, container } = renderEdgesEditor(three);
    expect(container.querySelector('input[placeholder*="Filter edges"]')).toBeNull();
    rerender(
      <EdgesEditor
        value={edges}
        onChange={jest.fn()}
        context={{
          options: { ...DEFAULT_PANEL_OPTIONS, nodes: NODES } as TopologyPanelOptions,
        } as never}
        item={{} as never}
      />
    );
    expect(container.querySelector('input[placeholder*="Filter edges"]')).not.toBeNull();
  });

  test('filter matches by source node name', () => {
    const { container } = renderEdgesEditor(edges);
    const filter = container.querySelector('input[placeholder*="Filter edges"]') as HTMLInputElement;
    // 'alpha' matches edges whose source is n-a (Alpha) = e-traffic, e-failover.
    act(() => { fireEvent.change(filter, { target: { value: 'alpha' } }); });
    expect(screen.queryByTestId('edge-card-e-traffic')).toBeInTheDocument();
    expect(screen.queryByTestId('edge-card-e-failover')).toBeInTheDocument();
    // e-monitor also touches Alpha (as target); it appears too.
    expect(screen.queryByTestId('edge-card-e-monitor')).toBeInTheDocument();
    // e-ha is n-b → n-c; no Alpha involvement.
    expect(screen.queryByTestId('edge-card-e-ha')).toBeNull();
  });

  test('filter matches by edge type', () => {
    const { container } = renderEdgesEditor(edges);
    const filter = container.querySelector('input[placeholder*="Filter edges"]') as HTMLInputElement;
    act(() => { fireEvent.change(filter, { target: { value: 'ha_sync' } }); });
    expect(screen.queryByTestId('edge-card-e-ha')).toBeInTheDocument();
    expect(screen.queryByTestId('edge-card-e-traffic')).toBeNull();
  });

  test('filter matches by source/target id (exact)', () => {
    const { container } = renderEdgesEditor(edges);
    const filter = container.querySelector('input[placeholder*="Filter edges"]') as HTMLInputElement;
    act(() => { fireEvent.change(filter, { target: { value: 'n-c' } }); });
    // Edges touching n-c are e-ha, e-failover, e-monitor.
    expect(screen.queryByTestId('edge-card-e-ha')).toBeInTheDocument();
    expect(screen.queryByTestId('edge-card-e-failover')).toBeInTheDocument();
    expect(screen.queryByTestId('edge-card-e-monitor')).toBeInTheDocument();
    expect(screen.queryByTestId('edge-card-e-traffic')).toBeNull();
  });

  test('filter with no matches renders the "No edges match" empty state', () => {
    const { container } = renderEdgesEditor(edges);
    const filter = container.querySelector('input[placeholder*="Filter edges"]') as HTMLInputElement;
    act(() => { fireEvent.change(filter, { target: { value: 'nonexistent' } }); });
    expect(screen.getByText(/No edges match/)).toBeInTheDocument();
  });
});

// ─── Cross-subtree edit-request subscription ──────────────────────────

describe('EdgesEditor — onEdgeEditRequest subscription', () => {
  test('emitting edit-request expands the matching card and forwards sectionHint', async () => {
    renderEdgesEditor([
      makeEdge({ id: 'e-1', sourceId: 'n-a', targetId: 'n-b' }),
      makeEdge({ id: 'e-2', sourceId: 'n-b', targetId: 'n-c' }),
    ]);
    // Before the emit both cards are collapsed.
    expect(screen.getByTestId('edge-card-e-1').getAttribute('data-is-open')).toBe('false');
    expect(screen.getByTestId('edge-card-e-2').getAttribute('data-is-open')).toBe('false');
    act(() => {
      emitEdgeEditRequest('e-2', 'thresholds');
    });
    // Only e-2 opens, with the section hint forwarded.
    await waitFor(() => {
      expect(screen.getByTestId('edge-card-e-2').getAttribute('data-is-open')).toBe('true');
    });
    expect(screen.getByTestId('edge-card-e-2').getAttribute('data-section-hint')).toBe('thresholds');
    expect(screen.getByTestId('edge-card-e-1').getAttribute('data-is-open')).toBe('false');
  });

  test('emitting without a section hint still opens the card with empty sectionHint', () => {
    renderEdgesEditor([makeEdge({ id: 'e-only' })]);
    act(() => {
      emitEdgeEditRequest('e-only');
    });
    const card = screen.getByTestId('edge-card-e-only');
    expect(card.getAttribute('data-is-open')).toBe('true');
    expect(card.getAttribute('data-section-hint')).toBe('');
  });
});
