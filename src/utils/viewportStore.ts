/**
 * viewportStore.ts — per-panel viewport persistence across remounts
 *
 * Grafana remounts the whole panel component when toggling view/edit mode,
 * which resets any React useState inside TopologyCanvas. Lifting state into
 * a module-level Map keyed by panel id lets the zoom/pan survive that
 * remount without touching dashboard JSON or storage APIs (both of which
 * are disallowed per the project's anti-patterns).
 *
 * Pure utility: no React, no side effects beyond the module-scope Map.
 */

import { ViewportState } from './viewport';

const viewportByPanelId = new Map<number, ViewportState>();

export function getStoredViewport(panelId: number): ViewportState | undefined {
  return viewportByPanelId.get(panelId);
}

export function setStoredViewport(panelId: number, viewport: ViewportState): void {
  viewportByPanelId.set(panelId, viewport);
}

export function clearStoredViewport(panelId: number): void {
  viewportByPanelId.delete(panelId);
}
