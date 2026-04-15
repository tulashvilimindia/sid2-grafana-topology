import { TopologyNode, TopologyEdge, AnchorPoint, EdgeType, EdgeStatus, NodeStatus, STATUS_COLORS, ThresholdStep } from '../types';

/** Status severity ranking: higher number = worse status */
const STATUS_SEVERITY: Record<NodeStatus | EdgeStatus, number> = {
  ok: 0,
  healthy: 0,
  nodata: 1,
  unknown: 1,
  warning: 2,
  saturated: 2,
  critical: 3,
  degraded: 3,
  down: 4,
};

/**
 * Returns true if candidate is worse than current status.
 * @param candidate — if undefined, returns false (treated as "not worse than current")
 * @param current — the baseline status to compare against
 */
export function isWorseStatus(candidate: NodeStatus | undefined, current: NodeStatus): boolean {
  if (!candidate) {
    return false;
  }
  return (STATUS_SEVERITY[candidate] || 0) > (STATUS_SEVERITY[current] || 0);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Get the anchor point coordinates for a node
 */
export function getAnchorPoint(rect: Rect, anchor: AnchorPoint, otherRect?: Rect): Point {
  if (anchor === 'auto' && otherRect) {
    // Auto-determine best anchor based on relative position
    const dx = otherRect.x + otherRect.w / 2 - (rect.x + rect.w / 2);
    const dy = otherRect.y + otherRect.h / 2 - (rect.y + rect.h / 2);
    if (Math.abs(dy) > Math.abs(dx)) {
      anchor = dy > 0 ? 'bottom' : 'top';
    } else {
      anchor = dx > 0 ? 'right' : 'left';
    }
  }

  switch (anchor) {
    case 'top':
      return { x: rect.x + rect.w / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case 'left':
      return { x: rect.x, y: rect.y + rect.h / 2 };
    case 'right':
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    default:
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
  }
}

/**
 * Generate a bezier curve path between two points
 */
export function getBezierPath(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Determine curve control points based on direction
  if (Math.abs(dy) > Math.abs(dx)) {
    // Vertical flow
    const cy = dy / 2;
    return `M${from.x} ${from.y} C${from.x} ${from.y + cy} ${to.x} ${to.y - cy} ${to.x} ${to.y}`;
  } else {
    // Horizontal flow
    const cx = dx / 2;
    return `M${from.x} ${from.y} C${from.x + cx} ${from.y} ${to.x - cx} ${to.y} ${to.x} ${to.y}`;
  }
}

/**
 * Calculate edge status from metric value, thresholds, and optional stateMap.
 *
 * When a stateMap is provided, it is consulted FIRST: the value is converted
 * to a string and looked up against the map's keys. If a valid color is
 * returned ('green' | 'yellow' | 'red'), the corresponding EdgeStatus is used
 * and thresholds are ignored. When the stateMap is absent, empty, or the value
 * has no matching key, the function falls back to numeric threshold logic.
 */
export function calculateEdgeStatus(
  value: number | null,
  thresholds: ThresholdStep[],
  stateMap?: Record<string, string>
): EdgeStatus {
  if (value === null || value === undefined) {
    return 'nodata';
  }

  // State map takes precedence for categorical metrics (e.g. HA sync 0/1)
  if (stateMap && Object.keys(stateMap).length > 0) {
    const mapped = stateMap[String(value)];
    if (mapped === 'red') { return 'degraded'; }
    if (mapped === 'yellow') { return 'saturated'; }
    if (mapped === 'green') { return 'healthy'; }
    // Unknown value → fall through to thresholds
  }

  // Sort thresholds descending
  const sorted = [...thresholds].sort((a, b) => b.value - a.value);
  for (const t of sorted) {
    if (value >= t.value) {
      switch (t.color) {
        case 'red':
          return 'degraded';
        case 'yellow':
          return 'saturated';
        case 'green':
        default:
          return 'healthy';
      }
    }
  }
  return 'healthy';
}

/**
 * Get edge color from status
 */
export function getEdgeColor(status: EdgeStatus): string {
  return STATUS_COLORS[status] || STATUS_COLORS.nodata;
}

/**
 * Calculate edge thickness from metric value
 */
export function calculateThickness(
  value: number | null,
  mode: 'fixed' | 'proportional' | 'threshold',
  min: number,
  max: number,
  thresholds: ThresholdStep[]
): number {
  if (value === null || mode === 'fixed') {
    return min;
  }

  if (mode === 'proportional') {
    // Proportional mode needs thresholds to normalize against. Without
    // them, thresholdMax would default to 1 and any value > 1 would
    // silently clamp to max thickness — misleading for metrics where the
    // user hasn't configured thresholds yet. Fall back to fixed-mode
    // behavior in that case.
    if (thresholds.length === 0) {
      return min;
    }
    // Normalize between min/max thickness based on threshold range
    const thresholdMax = Math.max(...thresholds.map((t) => t.value), 1);
    const ratio = Math.min(value / thresholdMax, 1);
    return min + ratio * (max - min);
  }

  // Threshold mode - step function
  const sorted = [...thresholds].sort((a, b) => b.value - a.value);
  for (let i = 0; i < sorted.length; i++) {
    if (value >= sorted[i].value) {
      const step = (max - min) / (sorted.length || 1);
      return min + (sorted.length - i) * step;
    }
  }
  return min;
}

/**
 * Calculate flow animation speed from metric value
 */
export function calculateFlowSpeed(
  value: number | null,
  mode: 'auto' | 'slow' | 'normal' | 'fast' | 'none',
  thresholds: ThresholdStep[]
): number {
  if (mode === 'none') {
    return 0;
  }

  const speeds: Record<string, number> = {
    slow: 2.5,
    normal: 1.4,
    fast: 0.6,
  };

  if (mode !== 'auto') {
    return speeds[mode] || 1.4;
  }

  // Auto: faster = more traffic
  if (value === null) {
    return 1.4;
  }

  const thresholdMax = Math.max(...thresholds.map((t) => t.value), 1);
  const ratio = Math.min(value / thresholdMax, 1);
  // Map 0-1 ratio to 2.5s (slow) - 0.5s (fast)
  return 2.5 - ratio * 2.0;
}

/**
 * Get the midpoint of a bezier curve (approximate)
 */
export function getBezierMidpoint(from: Point, to: Point): Point {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 - 10,
  };
}

/**
 * Edge style config per edge type
 */
export const EDGE_TYPE_STYLES: Record<EdgeType, { dashArray: string; opacity: number }> = {
  traffic: { dashArray: '', opacity: 1 },
  ha_sync: { dashArray: '6 4', opacity: 0.8 },
  failover: { dashArray: '2 4', opacity: 0.5 },
  monitor: { dashArray: '1 3', opacity: 0.6 },
  response: { dashArray: '4 6', opacity: 0.7 },
  custom: { dashArray: '', opacity: 1 },
};

/**
 * Propagate critical/degraded status upstream through edges.
 * When a node is critical, all edges pointing TO it get 'degraded' status,
 * and source nodes of those edges get a 'propagated' flag.
 *
 * Returns a Set of edge IDs that should show propagated (degraded) color.
 */
export function propagateStatus(
  nodeStatuses: Map<string, NodeStatus>,
  edges: Array<{ id: string; sourceId: string; targetId?: string }>
): Set<string> {
  const propagatedEdges = new Set<string>();

  edges.forEach((edge) => {
    if (!edge.targetId) {
      return;
    }
    const targetStatus = nodeStatuses.get(edge.targetId);
    if (targetStatus && isWorseStatus(targetStatus, 'ok') && targetStatus !== 'nodata' && targetStatus !== 'unknown') {
      propagatedEdges.add(edge.id);
    }
  });

  return propagatedEdges;
}
