import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ContextMenu, ContextMenuTarget } from '../ContextMenu';
import { STATUS_COLORS, TopologyNode, TopologyEdge, DEFAULT_EDGE } from '../../types';

function buildNode(overrides: Partial<TopologyNode> = {}): TopologyNode {
  return {
    id: 'n1',
    name: 'Node 1',
    role: '',
    type: 'server',
    metrics: [],
    position: { x: 0, y: 0 },
    compact: false,
    ...overrides,
  };
}

function buildEdge(overrides: Partial<TopologyEdge> = {}): TopologyEdge {
  return {
    ...(DEFAULT_EDGE as TopologyEdge),
    id: 'e1',
    sourceId: 'n1',
    targetId: 'n2',
    ...overrides,
  };
}

function renderMenu(overrides: Partial<React.ComponentProps<typeof ContextMenu>> = {}) {
  const props: React.ComponentProps<typeof ContextMenu> = {
    target: { type: 'node', id: 'n1' },
    position: { x: 10, y: 10 },
    panelRect: { width: 800, height: 600 },
    isEditMode: true,
    onEdit: jest.fn(),
    onDuplicate: jest.fn(),
    onDelete: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<ContextMenu {...props} />) };
}

describe('ContextMenu', () => {
  test('renders nothing when target is null', () => {
    renderMenu({ target: null });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('renders nothing when position is null', () => {
    renderMenu({ position: null });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('renders menu for node target with all items in edit mode', () => {
    renderMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Edit in sidebar')).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText('Copy node id')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('hides Edit item when not in edit mode', () => {
    renderMenu({ isEditMode: false });
    expect(screen.queryByText('Edit in sidebar')).toBeNull();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('Delete item is coloured with the critical status colour', () => {
    renderMenu();
    const deleteBtn = screen.getByText('Delete') as HTMLButtonElement;
    expect(deleteBtn.style.color).toBe(hexToRgb(STATUS_COLORS.critical));
  });

  test('click Delete invokes onDelete and onClose with the target', () => {
    const { props } = renderMenu();
    fireEvent.click(screen.getByText('Delete'));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledWith({ type: 'node', id: 'n1' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  test('click Duplicate invokes onDuplicate and onClose', () => {
    const { props } = renderMenu();
    fireEvent.click(screen.getByText('Duplicate'));
    expect(props.onDuplicate).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  test('outside mousedown closes the menu', () => {
    const { props } = renderMenu();
    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  test('mousedown inside the menu does NOT close it', () => {
    const { props } = renderMenu();
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  test('Escape key closes the menu', () => {
    const { props } = renderMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  test('edge target renders edge-specific items (no Copy node id)', () => {
    const edgeTarget: ContextMenuTarget = { type: 'edge', id: 'e1' };
    renderMenu({ target: edgeTarget });
    expect(screen.getByText('Edit in sidebar')).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Copy node id')).toBeNull();
  });

  test('clamps x when position would overflow right edge', () => {
    renderMenu({ position: { x: 700, y: 10 }, panelRect: { width: 800, height: 600 } });
    const menu = screen.getByRole('menu') as HTMLElement;
    // MENU_W=220, clamp = panelRect.width - MENU_W - 8 = 800 - 220 - 8 = 572
    expect(menu.style.left).toBe('572px');
  });

  test('clamps y when position would overflow bottom edge for a node menu', () => {
    renderMenu({ position: { x: 10, y: 550 }, panelRect: { width: 800, height: 600 } });
    const menu = screen.getByRole('menu') as HTMLElement;
    // Node menu in edit mode (no click-ops callbacks wired): Edit in sidebar
    // + divider + Duplicate + Copy node id + Delete. Estimated height:
    // 8 (padding) + 30 (edit) + 9 (div) + 30*3 (3 bottom items) = 137
    // Clamp = 600 - 137 - 8 = 455
    expect(menu.style.top).toBe('455px');
  });

  // ─── a11y: arrow-key navigation and initial focus ────────────
  //
  // The queueMicrotask-based initial focus needs one microtask flush
  // after render before the assertion sees the updated activeElement.

  test('first menuitem receives focus when menu opens', async () => {
    renderMenu();
    await Promise.resolve();
    expect(document.activeElement).toBe(screen.getByText('Edit in sidebar'));
  });

  test('ArrowDown cycles focus to the next menuitem', async () => {
    renderMenu();
    await Promise.resolve();
    // First item ("Edit in sidebar") is focused. ArrowDown → Duplicate.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByText('Duplicate'));
  });

  test('ArrowDown from the last menuitem wraps to the first', async () => {
    renderMenu();
    await Promise.resolve();
    // Focus the last item (Delete) directly, then ArrowDown should wrap.
    (screen.getByText('Delete') as HTMLButtonElement).focus();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByText('Edit in sidebar'));
  });
});

// ─── Hybrid click-ops: submenus + sidebar redirects (TASK 7) ────────────

describe('ContextMenu submenu + click-ops', () => {
  test('Change type submenu opens on click and shows all 37 node types', async () => {
    renderMenu({
      nodes: [buildNode({ type: 'server' })],
      onChangeNodeType: jest.fn(),
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Change type'));
    const submenu = await screen.findByTestId('topology-context-submenu');
    const items = within(submenu).getAllByRole('menuitem');
    expect(items).toHaveLength(37);
  });

  test('Change type submenu click fires onChangeNodeType with new type', async () => {
    const onChangeNodeType = jest.fn();
    renderMenu({
      nodes: [buildNode({ type: 'server' })],
      onChangeNodeType,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Change type'));
    const submenu = await screen.findByTestId('topology-context-submenu');
    fireEvent.click(within(submenu).getByText(/firewall/));
    expect(onChangeNodeType).toHaveBeenCalledTimes(1);
    expect(onChangeNodeType).toHaveBeenCalledWith('n1', 'firewall');
  });

  test('Change type submenu shows checkmark on current type', async () => {
    renderMenu({
      nodes: [buildNode({ type: 'server' })],
      onChangeNodeType: jest.fn(),
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Change type'));
    const submenu = await screen.findByTestId('topology-context-submenu');
    // Find the "server" row and verify it has a check element
    const serverRow = within(submenu).getByText(/SRV.*server/);
    const checks = submenu.querySelectorAll('[data-testid="contextmenu-check"]');
    // At least one check visible (the server row)
    expect(checks.length).toBeGreaterThanOrEqual(1);
    expect(serverRow).toBeInTheDocument();
  });

  test('Compact mode toggle click fires onToggleNodeCompact', async () => {
    const onToggleNodeCompact = jest.fn();
    renderMenu({
      nodes: [buildNode({ compact: false })],
      onToggleNodeCompact,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Compact mode'));
    expect(onToggleNodeCompact).toHaveBeenCalledTimes(1);
    expect(onToggleNodeCompact).toHaveBeenCalledWith('n1');
  });

  test('Compact mode shows checkmark when node.compact === true', async () => {
    renderMenu({
      nodes: [buildNode({ compact: true })],
      onToggleNodeCompact: jest.fn(),
    });
    await Promise.resolve();
    const compactButton = screen.getByText('Compact mode').closest('button');
    expect(compactButton).not.toBeNull();
    expect(compactButton!.querySelector('[data-testid="contextmenu-check"]')).not.toBeNull();
  });

  test('Edit metrics click fires onEditNodeSection with metrics section', async () => {
    const onEditNodeSection = jest.fn();
    renderMenu({
      nodes: [buildNode()],
      onEditNodeSection,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Edit metrics'));
    expect(onEditNodeSection).toHaveBeenCalledWith('n1', 'metrics');
  });

  test('Edit alert matchers click fires onEditNodeSection with alertMatchers', async () => {
    const onEditNodeSection = jest.fn();
    renderMenu({
      nodes: [buildNode()],
      onEditNodeSection,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Edit alert matchers'));
    expect(onEditNodeSection).toHaveBeenCalledWith('n1', 'alertMatchers');
  });

  test('Change edge type submenu click fires onChangeEdgeType', async () => {
    const onChangeEdgeType = jest.fn();
    renderMenu({
      target: { type: 'edge', id: 'e1' },
      edges: [buildEdge({ type: 'traffic' })],
      onChangeEdgeType,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Change type'));
    const submenu = await screen.findByTestId('topology-context-submenu');
    fireEvent.click(within(submenu).getByText('HA sync'));
    expect(onChangeEdgeType).toHaveBeenCalledWith('e1', 'ha_sync');
  });

  test('Anchor source submenu click fires onSetEdgeAnchor with source side', async () => {
    const onSetEdgeAnchor = jest.fn();
    renderMenu({
      target: { type: 'edge', id: 'e1' },
      edges: [buildEdge()],
      onSetEdgeAnchor,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Anchor source'));
    const submenu = await screen.findByTestId('topology-context-submenu');
    fireEvent.click(within(submenu).getByText('Top'));
    expect(onSetEdgeAnchor).toHaveBeenCalledWith('e1', 'source', 'top');
  });

  test('Anchor target submenu click fires onSetEdgeAnchor with target side', async () => {
    const onSetEdgeAnchor = jest.fn();
    renderMenu({
      target: { type: 'edge', id: 'e1' },
      edges: [buildEdge()],
      onSetEdgeAnchor,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Anchor target'));
    const submenu = await screen.findByTestId('topology-context-submenu');
    fireEvent.click(within(submenu).getByText('Bottom'));
    expect(onSetEdgeAnchor).toHaveBeenCalledWith('e1', 'target', 'bottom');
  });

  test('Flow speed submenu Inherit maps to undefined', async () => {
    const onSetEdgeFlowSpeed = jest.fn();
    renderMenu({
      target: { type: 'edge', id: 'e1' },
      edges: [buildEdge()],
      onSetEdgeFlowSpeed,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Flow speed'));
    const submenu = await screen.findByTestId('topology-context-submenu');
    fireEvent.click(within(submenu).getByText('Inherit from panel'));
    expect(onSetEdgeFlowSpeed).toHaveBeenCalledWith('e1', undefined);
  });

  test('Bidirectional toggle click fires onToggleEdgeBidirectional', async () => {
    const onToggleEdgeBidirectional = jest.fn();
    renderMenu({
      target: { type: 'edge', id: 'e1' },
      edges: [buildEdge({ bidirectional: false })],
      onToggleEdgeBidirectional,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Bidirectional'));
    expect(onToggleEdgeBidirectional).toHaveBeenCalledWith('e1');
  });

  test('Edit thresholds click fires onEditEdgeSection with thresholds', async () => {
    const onEditEdgeSection = jest.fn();
    renderMenu({
      target: { type: 'edge', id: 'e1' },
      edges: [buildEdge()],
      onEditEdgeSection,
    });
    await Promise.resolve();
    fireEvent.click(screen.getByText('Edit thresholds'));
    expect(onEditEdgeSection).toHaveBeenCalledWith('e1', 'thresholds');
  });

  test('click-ops items are hidden when isEditMode is false', async () => {
    renderMenu({
      isEditMode: false,
      nodes: [buildNode()],
      onChangeNodeType: jest.fn(),
      onToggleNodeCompact: jest.fn(),
      onEditNodeSection: jest.fn(),
    });
    await Promise.resolve();
    expect(screen.queryByText('Change type')).toBeNull();
    expect(screen.queryByText('Compact mode')).toBeNull();
    expect(screen.queryByText('Edit metrics')).toBeNull();
    // Standard items still visible in view mode
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('ArrowLeft inside a submenu closes the submenu without closing the root', async () => {
    const { props } = renderMenu({
      nodes: [buildNode({ type: 'server' })],
      onChangeNodeType: jest.fn(),
    });
    await Promise.resolve();
    // Open Change type submenu.
    fireEvent.click(screen.getByText('Change type'));
    expect(await screen.findByTestId('topology-context-submenu')).toBeInTheDocument();
    // ArrowLeft from within the submenu — the submenu's own handleKey
    // fires onEscape which, for the submenu path, collapses just that
    // submenu (not the whole menu). Root menu remains.
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.queryByTestId('topology-context-submenu')).toBeNull();
    expect(screen.getByTestId('topology-context-menu')).toBeInTheDocument();
    // Root onClose must not have fired.
    expect(props.onClose).not.toHaveBeenCalled();
  });

  test('Copy node id writes the id to the clipboard', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    // jsdom has navigator but not navigator.clipboard — define it.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    try {
      renderMenu();
      await Promise.resolve();
      fireEvent.click(screen.getByText('Copy node id'));
      expect(writeText).toHaveBeenCalledWith('n1');
    } finally {
      // Leave clipboard undefined for other tests that might depend on
      // its original (missing) state.
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });
    }
  });

  test('Copy node id swallows clipboard rejection (silent no-op)', async () => {
    const err = new Error('NotAllowed');
    const writeText = jest.fn().mockRejectedValue(err);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    try {
      renderMenu();
      await Promise.resolve();
      // Must not throw even though clipboard rejects.
      expect(() => fireEvent.click(screen.getByText('Copy node id'))).not.toThrow();
      // Flush the rejected promise — the .catch(() => {}) absorbs it.
      await Promise.resolve();
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });
    }
  });
});

/** jsdom normalizes inline hex colors to rgb() when read from .style. */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
