import React, { useEffect, useRef } from 'react';
import { STATUS_COLORS } from '../types';

/**
 * ContextMenu — floating action menu for a clicked node or edge.
 *
 * Rendered by TopologyPanel inside its panel-relative wrapper. The `position`
 * is already panel-relative (not viewport) — the component clamps it against
 * `panelRect` so the menu can never paint outside the panel.
 *
 * Closes on outside mousedown or Escape. Items call their handler and then
 * `onClose` so the parent doesn't need to track "did I consume the click".
 */

export type ContextMenuTarget = { type: 'node' | 'edge'; id: string };

export interface ContextMenuProps {
  target: ContextMenuTarget | null;
  position: { x: number; y: number } | null;
  panelRect: { width: number; height: number } | null;
  isEditMode: boolean;
  onEdit: (target: ContextMenuTarget) => void;
  onDuplicate: (target: ContextMenuTarget) => void;
  onDelete: (target: ContextMenuTarget) => void;
  onClose: () => void;
}

const MENU_W = 200;
const MENU_H_NODE = 144;
const MENU_H_EDGE = 108;

export const ContextMenu: React.FC<ContextMenuProps> = ({
  target, position, panelRect, isEditMode,
  onEdit, onDuplicate, onDelete, onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) { return; }
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Arrow-key navigation between menu items. Re-query on every press
      // so dynamic items (e.g. "Edit in sidebar" shown only in edit mode)
      // are handled correctly.
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') { return; }
      if (!containerRef.current) { return; }
      const items = containerRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (items.length === 0) { return; }
      const active = document.activeElement as HTMLElement | null;
      const idx = Array.from(items).indexOf(active as HTMLElement);
      const next = e.key === 'ArrowDown'
        ? items[(idx + 1 + items.length) % items.length]
        : items[(idx - 1 + items.length) % items.length];
      e.preventDefault();
      next.focus();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    // Move focus to the first menuitem on open so arrow keys and Enter
    // work immediately without requiring the user to Tab in. Deferred one
    // microtask so the DOM is painted before querying.
    queueMicrotask(() => {
      if (!containerRef.current) { return; }
      const firstItem = containerRef.current.querySelector<HTMLElement>('[role="menuitem"]');
      if (firstItem) { firstItem.focus(); }
    });
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [target, onClose]);

  if (!target || !position) { return null; }

  let { x, y } = position;
  const menuH = target.type === 'node' ? MENU_H_NODE : MENU_H_EDGE;
  if (panelRect) {
    if (x + MENU_W > panelRect.width) { x = Math.max(8, panelRect.width - MENU_W - 8); }
    if (y + menuH > panelRect.height) { y = Math.max(8, panelRect.height - menuH - 8); }
  }
  if (x < 8) { x = 8; }
  if (y < 8) { y = 8; }

  const handleItem = (action: (t: ContextMenuTarget) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    action(target);
    onClose();
  };

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    color: '#d8dee9',
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label={`${target.type} context menu`}
      data-testid="topology-context-menu"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: MENU_W,
        background: '#1a1e24',
        border: '1px solid #2d3748',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        zIndex: 200,
        padding: 4,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {isEditMode && (
        <button
          type="button"
          role="menuitem"
          style={itemStyle}
          onClick={handleItem(onEdit)}
        >
          Edit in sidebar
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        style={itemStyle}
        onClick={handleItem(onDuplicate)}
      >
        Duplicate
      </button>
      {target.type === 'node' && (
        <button
          type="button"
          role="menuitem"
          style={itemStyle}
          onClick={handleItem(() => {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              navigator.clipboard.writeText(target.id).catch(() => {
                // clipboard write can fail in unfocused iframes — silent no-op
              });
            }
          })}
        >
          Copy node id
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        style={{ ...itemStyle, color: STATUS_COLORS.critical }}
        onClick={handleItem(onDelete)}
      >
        Delete
      </button>
    </div>
  );
};
