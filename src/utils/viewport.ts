/**
 * viewport.ts — Viewport transform calculations for zoom/pan
 *
 * Pure utility: no React, no state, no side effects.
 */

export interface ViewportState {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Default viewport: no zoom, no pan */
export const DEFAULT_VIEWPORT: ViewportState = { scale: 1, translateX: 0, translateY: 0 };

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate viewport state that fits all nodes within the canvas.
 * Adds padding around the bounding box.
 */
export function fitToView(
  nodePositions: Map<string, Point>,
  nodeWidths: Map<string, number>,
  canvasWidth: number,
  canvasHeight: number,
  padding = 40
): ViewportState {
  if (nodePositions.size === 0) {
    return DEFAULT_VIEWPORT;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodePositions.forEach((pos, id) => {
    const w = nodeWidths.get(id) || 180;
    const h = 90;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + w);
    maxY = Math.max(maxY, pos.y + h);
  });

  const contentWidth = maxX - minX + padding * 2;
  const contentHeight = maxY - minY + padding * 2;

  if (contentWidth <= 0 || contentHeight <= 0) {
    return DEFAULT_VIEWPORT;
  }

  const scaleX = canvasWidth / contentWidth;
  const scaleY = canvasHeight / contentHeight;
  const scale = clamp(Math.min(scaleX, scaleY), 0.2, 2.0);

  const translateX = (canvasWidth - contentWidth * scale) / 2 - minX * scale + padding * scale;
  const translateY = (canvasHeight - contentHeight * scale) / 2 - minY * scale + padding * scale;

  return { scale, translateX, translateY };
}

/**
 * Apply zoom centered on a point.
 * Used for mouse wheel zoom — zooms toward the cursor position.
 */
export function zoomAtPoint(
  current: ViewportState,
  delta: number,
  cursorX: number,
  cursorY: number
): ViewportState {
  const factor = 1 - delta * 0.001;
  const newScale = clamp(current.scale * factor, 0.2, 3.0);
  const ratio = newScale / current.scale;

  // Zoom toward cursor: adjust translate so cursor position stays fixed
  const translateX = cursorX - (cursorX - current.translateX) * ratio;
  const translateY = cursorY - (cursorY - current.translateY) * ratio;

  return { scale: newScale, translateX, translateY };
}
