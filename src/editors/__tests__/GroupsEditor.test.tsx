// ─── Mocks ────────────────────────────────────────────────────────────
//
// GroupsEditor orchestrates a list of GroupCards and a filter input.
// Stub @grafana/ui primitives to keep tests focused on the list-level
// behavior (filter, add, delete, empty state). GroupCard itself is
// covered by GroupCard.test.tsx and stubbed here as a placeholder.

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

jest.mock('../components/GroupCard', () => ({
  GroupCard: ({ group, onDelete }: { group: { id: string; label: string }; onDelete: () => void }) => {
    const React = require('react');
    return React.createElement(
      'div',
      { 'data-testid': `group-card-${group.id}` },
      React.createElement('span', {}, group.label),
      React.createElement('button', { type: 'button', onClick: onDelete, 'data-testid': `delete-${group.id}` }, 'delete')
    );
  },
}));

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GroupsEditor } from '../GroupsEditor';
import { NodeGroup, TopologyNode, TopologyPanelOptions, DEFAULT_PANEL_OPTIONS } from '../../types';

const NODES: TopologyNode[] = [
  { id: 'n-a', name: 'Alpha', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
  { id: 'n-b', name: 'Beta', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
  { id: 'n-c', name: 'Gamma', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
];

function renderGroupsEditor(groups: NodeGroup[] = []) {
  const onChange = jest.fn();
  const context = {
    options: { ...DEFAULT_PANEL_OPTIONS, nodes: NODES } as TopologyPanelOptions,
  };
  const result = render(
    <GroupsEditor
      value={groups}
      onChange={onChange}
      context={context as never}
      item={{} as never}
    />
  );
  return { ...result, onChange };
}

describe('GroupsEditor — list behavior', () => {
  test('empty state renders instructional text when no groups defined', () => {
    renderGroupsEditor([]);
    expect(screen.getByText(/No groups defined/)).toBeInTheDocument();
  });

  test('Add button fires onChange with a new default group', () => {
    const { onChange } = renderGroupsEditor([]);
    fireEvent.click(screen.getByText('Add'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as NodeGroup[];
    expect(next).toHaveLength(1);
    expect(next[0].label).toBe('New group');
    expect(next[0].type).toBe('custom');
    expect(next[0].style).toBe('dashed');
    expect(next[0].nodeIds).toEqual([]);
    expect(next[0].id).toMatch(/^grp-/);
  });

  test('delete fires onChange with the group removed', () => {
    const initial: NodeGroup[] = [
      { id: 'grp-a', label: 'HA', type: 'ha_pair', nodeIds: ['n-a'], style: 'dashed' },
      { id: 'grp-b', label: 'Cluster', type: 'cluster', nodeIds: ['n-b'], style: 'solid' },
    ];
    const { onChange } = renderGroupsEditor(initial);
    fireEvent.click(screen.getByTestId('delete-grp-a'));
    expect(onChange).toHaveBeenCalledWith([
      { id: 'grp-b', label: 'Cluster', type: 'cluster', nodeIds: ['n-b'], style: 'solid' },
    ]);
  });
});

describe('GroupsEditor — filter', () => {
  const groups: NodeGroup[] = [
    { id: 'grp-ha', label: 'HA Pair', type: 'ha_pair', nodeIds: ['n-a'], style: 'dashed' },
    { id: 'grp-cluster', label: 'K8s Cluster', type: 'cluster', nodeIds: ['n-b'], style: 'solid' },
    { id: 'grp-pool', label: 'Server Pool', type: 'pool', nodeIds: ['n-c'], style: 'dashed' },
    { id: 'grp-custom', label: 'misc', type: 'custom', nodeIds: [], style: 'none' },
  ];

  test('filter input only renders when group count exceeds 3', () => {
    const three = groups.slice(0, 3);
    const { rerender, container } = renderGroupsEditor(three);
    // 3 groups: no filter input.
    expect(container.querySelector('input[placeholder*="Filter groups"]')).toBeNull();
    rerender(
      <GroupsEditor
        value={groups}
        onChange={jest.fn()}
        context={{
          options: { ...DEFAULT_PANEL_OPTIONS, nodes: NODES } as TopologyPanelOptions,
        } as never}
        item={{} as never}
      />
    );
    // 4 groups: filter input appears.
    expect(container.querySelector('input[placeholder*="Filter groups"]')).not.toBeNull();
  });

  test('filter matches by label substring (case-insensitive)', () => {
    const { container } = renderGroupsEditor(groups);
    const filter = container.querySelector('input[placeholder*="Filter groups"]') as HTMLInputElement;
    act(() => { fireEvent.change(filter, { target: { value: 'cluster' } }); });
    expect(screen.queryByTestId('group-card-grp-cluster')).toBeInTheDocument();
    expect(screen.queryByTestId('group-card-grp-ha')).toBeNull();
    expect(screen.queryByTestId('group-card-grp-pool')).toBeNull();
  });

  test('filter matches by type substring', () => {
    const { container } = renderGroupsEditor(groups);
    const filter = container.querySelector('input[placeholder*="Filter groups"]') as HTMLInputElement;
    act(() => { fireEvent.change(filter, { target: { value: 'ha_pair' } }); });
    expect(screen.queryByTestId('group-card-grp-ha')).toBeInTheDocument();
    expect(screen.queryByTestId('group-card-grp-cluster')).toBeNull();
  });

  test('filter matches by member node name', () => {
    // Filter 'alpha' — only grp-ha has n-a (Alpha) as a member.
    const { container } = renderGroupsEditor(groups);
    const filter = container.querySelector('input[placeholder*="Filter groups"]') as HTMLInputElement;
    act(() => { fireEvent.change(filter, { target: { value: 'alpha' } }); });
    expect(screen.queryByTestId('group-card-grp-ha')).toBeInTheDocument();
    expect(screen.queryByTestId('group-card-grp-cluster')).toBeNull();
    expect(screen.queryByTestId('group-card-grp-pool')).toBeNull();
    expect(screen.queryByTestId('group-card-grp-custom')).toBeNull();
  });

  test('filter with no matches renders the "No groups match" empty state', () => {
    const { container } = renderGroupsEditor(groups);
    const filter = container.querySelector('input[placeholder*="Filter groups"]') as HTMLInputElement;
    act(() => { fireEvent.change(filter, { target: { value: 'nonexistent' } }); });
    expect(screen.getByText(/No groups match/)).toBeInTheDocument();
  });
});
