import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ContextMenu, ContextMenuTarget } from '../ContextMenu';
import { STATUS_COLORS } from '../../types';

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
    // 800 - 200 - 8 = 592
    expect(menu.style.left).toBe('592px');
  });

  test('clamps y when position would overflow bottom edge for a node menu', () => {
    renderMenu({ position: { x: 10, y: 550 }, panelRect: { width: 800, height: 600 } });
    const menu = screen.getByRole('menu') as HTMLElement;
    // 600 - 144 - 8 = 448
    expect(menu.style.top).toBe('448px');
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

/** jsdom normalizes inline hex colors to rgb() when read from .style. */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
