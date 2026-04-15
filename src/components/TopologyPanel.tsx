import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { PanelProps } from '@grafana/data';
import { TopologyPanelOptions, TopologyNode, TopologyEdge, NodeRuntimeState, NodeStatus, NodeType, EdgeRuntimeState, MetricValue, NodeMetricConfig, FiringAlert, NODE_TYPE_CONFIG, STATUS_COLORS, MUTED_TEXT_COLOR, DEFAULT_EDGE } from '../types';
import { TopologyCanvas } from './TopologyCanvas';
import { autoLayout } from '../utils/layout';
import { calculateEdgeStatus, getEdgeColor, calculateThickness, calculateFlowSpeed, isWorseStatus, propagateStatus } from '../utils/edges';
import { QueryError } from '../utils/datasourceQuery';
import { useSelfQueries } from '../hooks/useSelfQueries';
import { useAlertRules } from '../hooks/useAlertRules';
import { useDynamicTargets } from '../hooks/useDynamicTargets';
import { emitNodeClicked, emitNodeEditRequest, emitEdgeEditRequest, emitOrphanEdgeCleanup, onOrphanEdgeCleanup, onTopologyImport } from '../utils/panelEvents';
import { getExampleTopology } from '../editors/exampleTopology';
import { NodePopup } from './NodePopup';
import { EdgePopup } from './EdgePopup';
import { ContextMenu, ContextMenuTarget } from './ContextMenu';
import { generateId } from '../editors/utils/editorUtils';
import './TopologyPanel.css';

interface Props extends PanelProps<TopologyPanelOptions> {}

export const TopologyPanel: React.FC<Props> = ({ id, options, onOptionsChange, data, width, height, replaceVariables }) => {
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [popupNodeId, setPopupNodeId] = useState<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  // Context-menu state. Null when closed. `position` is in
  // panel-relative coordinates — the child ContextMenu component clamps it
  // against panelRect so it cannot paint outside the panel.
  const [contextMenu, setContextMenu] = useState<{
    target: ContextMenuTarget;
    position: { x: number; y: number };
  } | null>(null);
  // Edge-popup state. Kept separate from the node popup so the
  // two popup lifecycles don't collide. Opening one closes the other.
  const [popupEdgeId, setPopupEdgeId] = useState<string | null>(null);
  const [popupEdgePosition, setPopupEdgePosition] = useState<{ x: number; y: number } | null>(null);
  const [timeOffset, setTimeOffset] = useState<number>(0); // 0 = now, negative = minutes ago
  const [exampleBannerVisible, setExampleBannerVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState<number>(36);
  const exampleBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nodes = useMemo(() => options.nodes || [], [options.nodes]);
  const edges = useMemo(() => options.edges || [], [options.edges]);
  const groups = useMemo(() => options.groups || [], [options.groups]);
  const { canvas, animation, layout, display } = options;

  // Memoized once — the URL query does not change during a panel's
  // lifetime, so this is effectively a const. Parsing once and passing
  // down as a prop is cheaper and more robust than 5 repeat parses.
  const isEditMode = useMemo(() => window.location.search.includes('editPanel'), []);

  // Derive node.groupId at runtime from NodeGroup.nodeIds so the layout
  // engine can sort grouped nodes adjacent within their tier. NodeGroup.nodeIds
  // remains the single source of truth — this derived view is never persisted.
  const nodesWithGroupId = useMemo(() => {
    const nodeToGroup = new Map<string, string>();
    groups.forEach((g) => {
      g.nodeIds.forEach((nid) => nodeToGroup.set(nid, g.id));
    });
    return nodes.map((n) => {
      const derivedGroupId = nodeToGroup.get(n.id);
      if (derivedGroupId === n.groupId) { return n; }
      return derivedGroupId ? { ...n, groupId: derivedGroupId } : { ...n, groupId: undefined };
    });
  }, [nodes, groups]);

  // Refs for stable closures in debounced/callback functions (CR-6, CR-7)
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Time travel: compute historical timestamp (0 = now/live)
  const historicalTime = useMemo(() => {
    if (timeOffset === 0) {
      return undefined;
    }
    return Math.floor(Date.now() / 1000) + timeOffset * 60;
  }, [timeOffset]);

  // Auto-fetch metrics not covered by panel queries (supports Prometheus, CloudWatch, Infinity)
  const { data: selfQueryResults, isLoading: isFetchingMetrics, failures: selfQueryFailures } = useSelfQueries(nodes, edges, data.series, replaceVariables, historicalTime);

  // Auto-fetch Grafana alert rules and match to nodes (only polls if ≥1 node has alertLabelMatchers)
  const alertsByNode = useAlertRules(nodes, animation.alertPollIntervalMs ?? 30000);

  // Auto-fetch dynamic target discovery for edges with targetQuery (only polls if ≥1 edge opts in)
  const targetsByEdge = useDynamicTargets(edges);

  // Expand edges with a targetQuery into N virtual edges — one per discovered target
  // value that matches an existing node. Virtual edge id is `${parentId}::${targetValue}`
  // so the edgeStates self-query lookup can fall back to the parent id for metric
  // inheritance. Unmatched target values (no existing node with that id) are dropped
  // with a console.warn; 3.1b will add nodeTemplate auto-creation for missing targets.
  const expandedEdges = useMemo<TopologyEdge[]>(() => {
    const hasDynamicEdges = edges.some((e) => e.targetQuery);
    if (!hasDynamicEdges) {
      return edges;
    }
    const existingNodeIds = new Set(nodes.map((n) => n.id));
    const result: TopologyEdge[] = [];
    edges.forEach((edge) => {
      if (!edge.targetQuery) {
        result.push(edge);
        return;
      }
      const discovered = targetsByEdge.get(edge.id) || [];
      discovered.forEach((targetValue) => {
        if (!existingNodeIds.has(targetValue)) {
          console.warn('[topology] dynamic target value has no matching node', { edgeId: edge.id, targetValue });
          return;
        }
        result.push({
          ...edge,
          id: `${edge.id}::${targetValue}`,
          targetId: targetValue,
          targetQuery: undefined,
        });
      });
    });
    return result;
  }, [edges, targetsByEdge, nodes]);

  // Ref to read current positions without triggering useEffect re-runs
  const nodePositionsRef = useRef(nodePositions);
  nodePositionsRef.current = nodePositions;

  // Initialize positions from node configs or auto-layout
  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }

    const currentPositions = nodePositionsRef.current;
    const allPositioned = nodes.every((n) => currentPositions.has(n.id));
    if (allPositioned) {
      return;
    }

    // Honor the layout.autoLayout toggle: when false, use stored node.position
    // directly for every node — even default (100,100) — and skip auto-layout.
    if (!layout.autoLayout) {
      const positions = new Map<string, { x: number; y: number }>();
      nodes.forEach((node) => {
        const existing = currentPositions.get(node.id);
        positions.set(node.id, existing || { ...node.position });
      });
      setNodePositions(positions);
      return;
    }

    const positions = new Map<string, { x: number; y: number }>();
    let needsAutoLayout = false;

    nodes.forEach((node) => {
      const existing = currentPositions.get(node.id);
      if (existing) {
        positions.set(node.id, existing);
      } else if (node.position && (node.position.x !== 100 || node.position.y !== 100)) {
        positions.set(node.id, { ...node.position });
      } else {
        needsAutoLayout = true;
      }
    });

    if (needsAutoLayout || positions.size < nodes.length) {
      const autoPositions = autoLayout(nodesWithGroupId, expandedEdges, {
        direction: layout.direction,
        tierSpacing: layout.tierSpacing,
        nodeSpacing: layout.nodeSpacing,
        canvasWidth: width,
        canvasHeight: height,
      });
      autoPositions.forEach((pos, id) => {
        if (!positions.has(id)) {
          positions.set(id, pos);
        }
      });
    }

    setNodePositions(positions);
  }, [nodes, nodesWithGroupId, expandedEdges, layout, width, height]);

  // Compute runtime state from data frames + self-queried results
  const nodeStates = useMemo<Map<string, NodeRuntimeState>>(() => {
    const states = new Map<string, NodeRuntimeState>();

    nodes.forEach((node) => {
      const metricValues: Record<string, MetricValue> = {};
      let worstStatus: NodeStatus = node.metrics.length === 0 ? 'nodata' : 'ok';

      node.metrics.forEach((metricConfig) => {
        // Try panel data first. Matching precedence:
        //  1. Explicit refId — preferred when the user has wired a Grafana panel query
        //  2. Internal id — legacy / backward-compat fallback
        //  3. Label — last-resort name-based match
        const matchingFrame = data.series.find(
          (frame) =>
            (metricConfig.refId && frame.refId === metricConfig.refId) ||
            (!metricConfig.refId && frame.refId === metricConfig.id) ||
            frame.name === metricConfig.label
        );

        let raw: number | null = null;
        let sparklineValues: number[] | undefined;

        if (matchingFrame && matchingFrame.fields.length > 1) {
          const valueField = matchingFrame.fields.find((f) => f.type === 'number');
          if (valueField && valueField.values.length > 0) {
            raw = valueField.values[valueField.values.length - 1] as number;
            if (metricConfig.showSparkline) {
              sparklineValues = Array.from(valueField.values).slice(-12) as number[];
            }
          }
        }

        // Fallback: try self-queried data. Track whether the value came from
        // a self-query so we can attach the freshness timestamp only where
        // it's meaningful (panel-query metrics use Grafana's own refresh UX).
        let selfQueryFetchedAt: number | undefined;
        if (raw === null && selfQueryResults.has(metricConfig.id)) {
          const selfResult = selfQueryResults.get(metricConfig.id);
          raw = selfResult?.value ?? null;
          selfQueryFetchedAt = selfResult?.fetchedAt;
        }

        if (raw !== null) {
          let status: 'ok' | 'warning' | 'critical' = 'ok';
          for (const t of [...metricConfig.thresholds].sort((a, b) => b.value - a.value)) {
            if (raw >= t.value) {
              status = t.color === 'red' ? 'critical' : t.color === 'yellow' ? 'warning' : 'ok';
              break;
            }
          }

          if (status === 'critical') {
            worstStatus = 'critical';
          } else if (status === 'warning' && worstStatus !== 'critical') {
            worstStatus = 'warning';
          }

          metricValues[metricConfig.id] = {
            raw,
            formatted: formatMetricValue(raw, metricConfig.format),
            status,
            sparklineData: sparklineValues,
            fetchedAt: selfQueryFetchedAt,
          };
        }

        if (!metricValues[metricConfig.id]) {
          metricValues[metricConfig.id] = {
            raw: null,
            formatted: 'N/A',
            status: 'unknown',
          };
        }
      });

      // Alert-rule override: firing → critical, pending → warning (unless already critical)
      const matched = alertsByNode.get(node.id);
      let firingAlerts: FiringAlert[] | undefined;
      if (matched && matched.length > 0) {
        firingAlerts = matched;
        const hasFiring = matched.some((a) => a.state === 'firing');
        const hasPending = matched.some((a) => a.state === 'pending');
        if (hasFiring) {
          worstStatus = 'critical';
        } else if (hasPending && (worstStatus as NodeStatus) !== 'critical') {
          worstStatus = 'warning';
        }
      }

      states.set(node.id, {
        nodeId: node.id,
        status: worstStatus,
        metricValues,
        expanded: expandedNodes.has(node.id),
        firingAlerts,
      });
    });

    return states;
  }, [nodes, data, expandedNodes, selfQueryResults, alertsByNode]);

  // Compute health summary: worst status per node type for toolbar indicator
  const healthSummary = useMemo<Array<{ type: NodeType; icon: string; color: string; status: NodeStatus; count: number }>>(() => {
    const byType = new Map<NodeType, { status: NodeStatus; count: number }>();
    nodes.forEach((node) => {
      const state = nodeStates.get(node.id);
      const current = byType.get(node.type) || { status: 'ok' as NodeStatus, count: 0 };
      current.count++;
      if (state && isWorseStatus(state.status, current.status)) {
        current.status = state.status;
      } else if (current.count === 1 && !state) {
        current.status = 'nodata';
      }
      byType.set(node.type, current);
    });
    return Array.from(byType).map(([type, data]) => ({
      type,
      icon: NODE_TYPE_CONFIG[type]?.icon || '?',
      color: STATUS_COLORS[data.status] || STATUS_COLORS.nodata,
      status: data.status,
      count: data.count,
    }));
  }, [nodes, nodeStates]);

  // Derive stale-metric summary for toolbar pill
  const failureSummary = useMemo(() => {
    const byError: Record<QueryError, number> = { network: 0, http: 0, parse: 0 };
    const ids: string[] = [];
    selfQueryFailures.forEach((err, id) => {
      byError[err]++;
      ids.push(`${id} (${err})`);
    });
    return { total: selfQueryFailures.size, byError, ids };
  }, [selfQueryFailures]);

  // Status propagation: find edges leading to critical nodes (operates on expanded list
  // so virtual edges from dynamic-target parents inherit degraded status propagation).
  const propagatedEdgeIds = useMemo(() => {
    const statuses = new Map<string, NodeStatus>();
    nodeStates.forEach((state, id) => { statuses.set(id, state.status); });
    return propagateStatus(statuses, expandedEdges);
  }, [nodeStates, expandedEdges]);

  // Compute edge runtime state from data frames (iterates expanded list so virtual
  // edges from dynamic-target parents get their own runtime state).
  const edgeStates = useMemo<Map<string, EdgeRuntimeState>>(() => {
    const states = new Map<string, EdgeRuntimeState>();

    expandedEdges.forEach((edge) => {
      let value: number | null = null;

      // For virtual edges (id contains "::"), the parent edge id is the prefix.
      // Metric lookups fall back to the parent so all virtual edges inherit the
      // parent's fetched metric value.
      const parentIdForLookup = edge.id.includes('::') ? edge.id.split('::')[0] : edge.id;

      if (edge.metric) {
        const matchingFrame = data.series.find(
          (frame) => frame.refId === parentIdForLookup || frame.name === edge.metric!.alias
        );
        if (matchingFrame && matchingFrame.fields.length > 1) {
          const valueField = matchingFrame.fields.find((f) => f.type === 'number');
          if (valueField && valueField.values.length > 0) {
            value = valueField.values[valueField.values.length - 1] as number;
          }
        }
      }

      // Fallback: try self-queried edge metric data (keyed on the parent id)
      if (value === null && selfQueryResults.has(parentIdForLookup)) {
        value = selfQueryResults.get(parentIdForLookup)?.value ?? null;
      }

      const status = calculateEdgeStatus(value, edge.thresholds, edge.stateMap);
      // Apply status propagation: edges leading to critical nodes show degraded color
      const effectiveStatus = propagatedEdgeIds.has(edge.id) && status === 'healthy' ? 'degraded' : status;
      const color = getEdgeColor(effectiveStatus);
      const thickness = calculateThickness(value, edge.thicknessMode, edge.thicknessMin, edge.thicknessMax, edge.thresholds);
      const effectiveFlowSpeed = edge.flowSpeed || animation.defaultFlowSpeed || 'auto';
      const animationSpeed = animation.flowEnabled && edge.flowAnimation
        ? calculateFlowSpeed(value, effectiveFlowSpeed, edge.thresholds)
        : 0;

      let formattedLabel: string | undefined;
      if (edge.labelTemplate) {
        if (value !== null) {
          formattedLabel = formatMetricValue(value, edge.labelTemplate);
        } else {
          formattedLabel = edge.labelTemplate.replace('${value}', 'N/A');
        }
      }

      states.set(edge.id, {
        edgeId: edge.id,
        status,
        value: value ?? undefined,
        formattedLabel,
        thickness,
        color,
        animationSpeed,
      });
    });

    return states;
  }, [expandedEdges, data, animation.flowEnabled, animation.defaultFlowSpeed, selfQueryResults, propagatedEdgeIds]);

  // Persist positions
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cleanup persist timer on unmount
  useEffect(() => {
    return () => { if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); } };
  }, []);
  const persistPositions = useCallback((positions: Map<string, { x: number; y: number }>) => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      const currentNodes = nodesRef.current;
      const currentOptions = optionsRef.current;
      const updatedNodes = currentNodes.map((n) => {
        const pos = positions.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
      onOptionsChange({ ...currentOptions, nodes: updatedNodes });
    }, 300);
  }, [onOptionsChange]);

  const handleNodeDrag = useCallback(
    (nodeId: string, x: number, y: number) => {
      setNodePositions((prev) => {
        const next = new Map(prev);
        let pos = { x, y };
        if (canvas.snapToGrid) {
          pos = {
            x: Math.round(x / canvas.gridSize) * canvas.gridSize,
            y: Math.round(y / canvas.gridSize) * canvas.gridSize,
          };
        }
        next.set(nodeId, pos);
        persistPositions(next);
        return next;
      });
    },
    [canvas.snapToGrid, canvas.gridSize, persistPositions]
  );

  const handleNodeToggle = useCallback((nodeId: string, rect?: DOMRect) => {
    // Opening a node popup closes any open edge popup so only one
    // floating UI is visible at a time.
    setPopupEdgeId(null);
    setPopupEdgePosition(null);
    if (isEditMode) {
      // Edit mode: sidebar is the expansion target. Emit the event so
      // NodesEditor scrolls/expands its card, and return early WITHOUT
      // toggling the canvas expanded-metrics section — expanding both
      // at once is visual noise and confuses the user about which
      // surface they're editing.
      emitNodeClicked(nodeId);
      return;
    }
    // View mode: toggle popup AND expand the card's metrics section.
    // Compute panel-relative popup position from the clicked node's
    // DOMRect, clamped to panel bounds.
    setPopupNodeId((prev) => {
      const next = prev === nodeId ? null : nodeId;
      if (next && rect && panelRef.current) {
        const panelRect = panelRef.current.getBoundingClientRect();
        const POPUP_W = 240;
        const POPUP_H = 300;
        // Default: position to the right of the node with an 8px gap
        let x = rect.right - panelRect.left + 8;
        let y = rect.top - panelRect.top;
        // If popup would overflow the right edge, place it to the LEFT of the node
        if (x + POPUP_W > panelRect.width) {
          x = rect.left - panelRect.left - POPUP_W - 8;
        }
        // If it still doesn't fit (node near left edge), clamp to left with small margin
        if (x < 8) {
          x = 8;
        }
        // Clamp bottom so popup fits vertically within the panel
        if (y + POPUP_H > panelRect.height) {
          y = Math.max(8, panelRect.height - POPUP_H - 8);
        }
        if (y < 8) {
          y = 8;
        }
        setPopupPosition({ x, y });
      } else if (!next) {
        setPopupPosition(null);
      }
      return next;
    });
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) { next.delete(nodeId); } else { next.add(nodeId); }
      return next;
    });
  }, [isEditMode]);

  // Double-click emits the edit-request event. Only NodesEditor subscribes, so
  // this is a no-op in view mode and opens+scrolls the card in edit mode.
  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    emitNodeEditRequest(nodeId);
  }, []);

  // Right-click handlers: TopologyCanvas passes raw client coordinates;
  // convert to panel-relative here so ContextMenu's clamping uses the same
  // coordinate system as NodePopup and friends. Opening the context menu
  // also closes any open node popup so only one floating UI is visible.
  const handleNodeContextMenu = useCallback((nodeId: string, clientX: number, clientY: number) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) { return; }
    setPopupNodeId(null);
    setPopupPosition(null);
    setContextMenu({
      target: { type: 'node', id: nodeId },
      position: { x: clientX - rect.left, y: clientY - rect.top },
    });
  }, []);

  const handleEdgeContextMenu = useCallback((edgeId: string, clientX: number, clientY: number) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) { return; }
    setPopupNodeId(null);
    setPopupPosition(null);
    setContextMenu({
      target: { type: 'edge', id: edgeId },
      position: { x: clientX - rect.left, y: clientY - rect.top },
    });
  }, []);

  // Context-menu action dispatch. Edit routes to the panelEvents channels so
  // the sidebar editor scrolls the matching card. Duplicate and Delete mutate
  // the matching slice via onOptionsChange. Delete on a node also emits the
  // orphan-edge-cleanup channel so dangling edges are trimmed the same way
  // NodesEditor's own delete flow works.
  const handleContextEdit = useCallback((target: ContextMenuTarget) => {
    if (target.type === 'node') {
      emitNodeEditRequest(target.id);
    } else {
      emitEdgeEditRequest(target.id);
    }
  }, []);

  const handleContextDuplicate = useCallback((target: ContextMenuTarget) => {
    const current = optionsRef.current;
    if (target.type === 'node') {
      const src = (current.nodes || []).find((n) => n.id === target.id);
      if (!src) { return; }
      const dup: TopologyNode = {
        ...src,
        id: generateId('n'),
        name: `${src.name} copy`,
        position: src.position
          ? { x: src.position.x + 20, y: src.position.y + 20 }
          : src.position,
      };
      onOptionsChange({ ...current, nodes: [...(current.nodes || []), dup] });
    } else {
      const src = (current.edges || []).find((e) => e.id === target.id);
      if (!src) { return; }
      // Virtual edges (id contains '::') are runtime-only; duplicating them
      // would just create another virtual-looking id that collides. Skip.
      if (src.id.includes('::')) { return; }
      const dup: TopologyEdge = { ...src, id: generateId('e') };
      onOptionsChange({ ...current, edges: [...(current.edges || []), dup] });
    }
  }, [onOptionsChange]);

  // Drag-to-connect handler. TopologyCanvas fires this when the
  // user Shift+drags from one node to another. Validate (source != target,
  // source exists) and append a new edge via onOptionsChange. Parallel-pair
  // duplicates are deliberately allowed — the canvas already renders them
  // with a perpendicular offset, and blocking duplicates would deny the
  // legitimate case of multiple distinct metrics on the same hop.
  const handleEdgeCreate = useCallback((sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) { return; }
    const current = optionsRef.current;
    const currentNodes = current.nodes || [];
    // Both endpoints must exist as persisted (non-virtual) nodes.
    const sourceExists = currentNodes.some((n) => n.id === sourceId);
    const targetExists = currentNodes.some((n) => n.id === targetId);
    if (!sourceExists || !targetExists) { return; }
    const newEdge: TopologyEdge = {
      ...(DEFAULT_EDGE as TopologyEdge),
      id: generateId('e'),
      sourceId,
      targetId,
    };
    onOptionsChange({ ...current, edges: [...(current.edges || []), newEdge] });
    // Auto-surface the new edge in the sidebar editor so the user can
    // immediately configure its metric / thresholds.
    emitEdgeEditRequest(newEdge.id);
  }, [onOptionsChange]);

  // Left-click on an edge: open an EdgePopup at the click point,
  // clamped to panel bounds the same way handleNodeToggle does for nodes.
  // Opening the edge popup also closes any open node popup.
  const handleEdgeClick = useCallback((edgeId: string, clientX: number, clientY: number) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) { return; }
    const POPUP_W = 240;
    const POPUP_H = 260;
    let x = clientX - rect.left + 8;
    let y = clientY - rect.top;
    if (x + POPUP_W > rect.width) { x = Math.max(8, clientX - rect.left - POPUP_W - 8); }
    if (x < 8) { x = 8; }
    if (y + POPUP_H > rect.height) { y = Math.max(8, rect.height - POPUP_H - 8); }
    if (y < 8) { y = 8; }
    setPopupNodeId(null);
    setPopupPosition(null);
    setContextMenu(null);
    setPopupEdgeId(edgeId);
    setPopupEdgePosition({ x, y });
  }, []);

  const handleContextDelete = useCallback((target: ContextMenuTarget) => {
    const current = optionsRef.current;
    if (target.type === 'node') {
      const filtered = (current.nodes || []).filter((n) => n.id !== target.id);
      onOptionsChange({ ...current, nodes: filtered });
      emitOrphanEdgeCleanup(target.id);
    } else {
      if (target.id.includes('::')) { return; }
      const filtered = (current.edges || []).filter((e) => e.id !== target.id);
      onOptionsChange({ ...current, edges: filtered });
    }
  }, [onOptionsChange]);

  // Subscribe to orphan-edge-cleanup events fired by NodesEditor after a node
  // delete. setTimeout(0) yields one tick so NodesEditor's own slice update
  // (the node removal) has already propagated through Grafana's onOptionsChange
  // pipeline — optionsRef.current is then guaranteed to reflect the removed
  // node, and we apply a second onOptionsChange for the edges slice.
  useEffect(() => {
    return onOrphanEdgeCleanup((deletedNodeId) => {
      setTimeout(() => {
        const current = optionsRef.current;
        const currentEdges = current.edges || [];
        const filtered = currentEdges.filter(
          (e) => e.sourceId !== deletedNodeId && e.targetId !== deletedNodeId
        );
        if (filtered.length < currentEdges.length) {
          onOptionsChange({ ...current, edges: filtered });
        }
      }, 0);
    });
  }, [onOptionsChange]);

  // Subscribe to topology-import events fired by NodesEditor. The payload
  // is a partial options object covering any mix of slices the JSON file
  // provided; merge it over the current options so omitted slices are
  // preserved. setTimeout(0) yields a tick so any nodes slice update
  // NodesEditor applied via its own onChange settles first.
  useEffect(() => {
    return onTopologyImport((partial) => {
      setTimeout(() => {
        onOptionsChange({ ...optionsRef.current, ...partial });
      }, 0);
    });
  }, [onOptionsChange]);

  const handleResetLayout = useCallback(() => {
    const autoPositions = autoLayout(nodesWithGroupId, expandedEdges, {
      direction: layout.direction,
      tierSpacing: layout.tierSpacing,
      nodeSpacing: layout.nodeSpacing,
      canvasWidth: width,
      canvasHeight: height,
    });
    setNodePositions(autoPositions);
    setExpandedNodes(new Set());
  }, [nodesWithGroupId, expandedEdges, layout, width, height]);

  const handleLoadExample = useCallback(() => {
    const exampleTopology = getExampleTopology();
    onOptionsChange({ ...options, ...exampleTopology } as TopologyPanelOptions);
    // Show a transient banner explaining that example metrics are visual
    // mocks. Auto-dismiss after 12s; the user can also close it manually.
    setExampleBannerVisible(true);
    if (exampleBannerTimerRef.current) { clearTimeout(exampleBannerTimerRef.current); }
    exampleBannerTimerRef.current = setTimeout(() => {
      setExampleBannerVisible(false);
      exampleBannerTimerRef.current = null;
    }, 12000);
  }, [options, onOptionsChange]);

  // Clean up the banner timer on unmount so a pending setTimeout cannot
  // call setState after the component is gone.
  useEffect(() => {
    return () => {
      if (exampleBannerTimerRef.current) {
        clearTimeout(exampleBannerTimerRef.current);
        exampleBannerTimerRef.current = null;
      }
    };
  }, []);

  // Observe the toolbar's rendered height so the canvas adapts when the
  // toolbar wraps to 2+ rows on narrow viewports (the mobile media query
  // sets flex-wrap: wrap). Hardcoding 36px caused the canvas to overflow
  // when wrapped. ResizeObserver is guarded for jsdom (the test env
  // does not provide it).
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') { return; }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setToolbarHeight(Math.ceil(entry.contentRect.height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandedNodes((prev) => {
      if (prev.size === nodes.length) { return new Set(); }
      return new Set(nodes.map((n) => n.id));
    });
  }, [nodes]);

  return (
    <div
      ref={panelRef}
      className="topology-panel"
      style={{ width, height, backgroundColor: canvas.backgroundColor }}
      onClick={() => {
        setPopupNodeId(null);
        setPopupPosition(null);
        setContextMenu(null);
        setPopupEdgeId(null);
        setPopupEdgePosition(null);
      }}
    >
      <div className="topology-toolbar" ref={toolbarRef}>
        <span className="topology-title">E2E topology</span>
        {isFetchingMetrics && <span style={{ fontSize: 9, color: MUTED_TEXT_COLOR, marginLeft: 6 }}>Loading...</span>}
        {healthSummary.length > 0 && (
          <div className="topology-health-bar">
            {healthSummary.map((h) => (
              <span
                key={h.type}
                className="topology-health-dot"
                style={{ background: h.color }}
                title={`${h.icon} ${h.type} (${h.count}): ${h.status}`}
              />
            ))}
          </div>
        )}
        {failureSummary.total > 0 && (
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 3,
              background: `${STATUS_COLORS.warning}22`,
              color: STATUS_COLORS.warning,
              border: `1px solid ${STATUS_COLORS.warning}44`,
              marginLeft: 6,
              whiteSpace: 'nowrap',
              cursor: 'help',
            }}
            title={`Stale metrics (${failureSummary.total}):\n${failureSummary.ids.join('\n')}`}
          >
            ⚠ {failureSummary.total} stale
          </span>
        )}
        <div className="topology-toolbar-spacer" />
        <button className="topology-btn" onClick={handleResetLayout}>
          Auto layout
        </button>
        <button className="topology-btn" onClick={handleExpandAll}>
          {expandedNodes.size === nodes.length ? 'Collapse all' : 'Expand all'}
        </button>
        {nodes.length === 0 && (
          <button className="topology-btn" onClick={handleLoadExample}>
            Load example
          </button>
        )}
        <select
          className="topology-btn"
          value={timeOffset}
          onChange={(e) => setTimeOffset(parseInt(e.target.value, 10))}
          title="Time travel: view topology at a past time"
        >
          <option value={0}>Live</option>
          <option value={-5}>5m ago</option>
          <option value={-15}>15m ago</option>
          <option value={-30}>30m ago</option>
          <option value={-60}>1h ago</option>
          <option value={-180}>3h ago</option>
          <option value={-360}>6h ago</option>
          <option value={-1440}>24h ago</option>
        </select>
      </div>
      {timeOffset !== 0 && (
        <div className="topology-time-banner">
          <span>Viewing: {Math.abs(timeOffset) >= 60 ? Math.abs(timeOffset) / 60 + 'h' : Math.abs(timeOffset) + 'm'} ago</span>
          <button className="topology-btn" onClick={() => setTimeOffset(0)}>Back to Live</button>
        </div>
      )}
      {exampleBannerVisible && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            background: '#5e81ac22',
            borderBottom: '1px solid #5e81ac44',
            color: '#88c0d0',
            fontSize: 11,
            height: 28,
            boxSizing: 'border-box',
          }}
        >
          <span style={{ flex: 1 }}>
            Example topology loaded. Metrics are visual mocks — configure datasources in the panel editor to see live data.
          </span>
          <button
            type="button"
            onClick={() => {
              setExampleBannerVisible(false);
              if (exampleBannerTimerRef.current) {
                clearTimeout(exampleBannerTimerRef.current);
                exampleBannerTimerRef.current = null;
              }
            }}
            aria-label="Dismiss example banner"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#88c0d0',
              cursor: 'pointer',
              fontSize: 14,
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>
      )}
      <TopologyCanvas
        nodes={nodes}
        edges={expandedEdges}
        groups={groups}
        nodePositions={nodePositions}
        nodeStates={nodeStates}
        edgeStates={edgeStates}
        canvasOptions={canvas}
        animationOptions={animation}
        displayOptions={display}
        width={width}
        height={height - toolbarHeight - (timeOffset !== 0 ? 28 : 0) - (exampleBannerVisible ? 28 : 0)}
        panelId={id}
        onNodeDrag={handleNodeDrag}
        onNodeToggle={handleNodeToggle}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        onEdgeClick={handleEdgeClick}
        onEdgeCreate={handleEdgeCreate}
        isEditMode={isEditMode}
      />
      <ContextMenu
        target={contextMenu?.target ?? null}
        position={contextMenu?.position ?? null}
        panelRect={{ width, height }}
        isEditMode={isEditMode}
        onEdit={handleContextEdit}
        onDuplicate={handleContextDuplicate}
        onDelete={handleContextDelete}
        onClose={() => setContextMenu(null)}
      />
      {popupNodeId && (() => {
        const popupNode = nodes.find((n) => n.id === popupNodeId);
        if (!popupNode) { return null; }
        const popupAlerts = nodeStates.get(popupNodeId)?.firingAlerts;
        // Use dynamic popupPosition when available; fall back to fixed top-right for
        // backward-compat (e.g. popups triggered without a rect, or very small panels).
        const wrapperStyle: React.CSSProperties = popupPosition
          ? { position: 'absolute', left: popupPosition.x, top: popupPosition.y, zIndex: 100 }
          : { position: 'absolute', top: 44, right: 8, zIndex: 100 };
        // In edit mode, expose an "Edit" shortcut that emits on the
        // panelEvents channel and closes the popup. NodesEditor subscribes
        // to the same channel and scrolls the matching card into view.
        const handleEdit = isEditMode
          ? () => {
              emitNodeEditRequest(popupNode.id);
              setPopupNodeId(null);
              setPopupPosition(null);
            }
          : undefined;
        return (
          <div style={wrapperStyle} onClick={(e) => e.stopPropagation()}>
            <NodePopup
              node={popupNode}
              firingAlerts={popupAlerts}
              onClose={() => { setPopupNodeId(null); setPopupPosition(null); }}
              onEdit={handleEdit}
              metricValues={nodeStates.get(popupNodeId)?.metricValues}
              freshnessSLOSec={animation.metricFreshnessSLOSec}
              replaceVars={replaceVariables}
            />
          </div>
        );
      })()}
      {popupEdgeId && popupEdgePosition && (() => {
        const popupEdge = expandedEdges.find((e) => e.id === popupEdgeId);
        if (!popupEdge) { return null; }
        const sourceNode = nodes.find((n) => n.id === popupEdge.sourceId);
        const targetNode = nodes.find((n) => n.id === popupEdge.targetId);
        // Edit routes through the edge-edit-request panelEvents channel;
        // EdgesEditor subscribes and scrolls/expands the matching card.
        // Virtual edges (id contains '::') have no real slice entry, so
        // the edit button is hidden for them.
        const handleEdit = isEditMode && !popupEdge.id.includes('::')
          ? () => {
              emitEdgeEditRequest(popupEdge.id);
              setPopupEdgeId(null);
              setPopupEdgePosition(null);
            }
          : undefined;
        return (
          <div
            style={{ position: 'absolute', left: popupEdgePosition.x, top: popupEdgePosition.y, zIndex: 100 }}
            onClick={(e) => e.stopPropagation()}
          >
            <EdgePopup
              edge={popupEdge}
              runtimeState={edgeStates.get(popupEdgeId)}
              sourceName={sourceNode?.name || popupEdge.sourceId}
              targetName={targetNode?.name || popupEdge.targetId || 'unknown'}
              onClose={() => { setPopupEdgeId(null); setPopupEdgePosition(null); }}
              onEdit={handleEdit}
              replaceVars={replaceVariables}
            />
          </div>
        );
      })()}
    </div>
  );
};

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1e9) {
    return (value / 1e9).toFixed(1) + 'G';
  }
  if (Math.abs(value) >= 1e6) {
    return (value / 1e6).toFixed(1) + 'M';
  }
  if (Math.abs(value) >= 1e3) {
    return (value / 1e3).toFixed(1) + 'k';
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(1);
}

/** Format seconds as human-readable duration */
function formatDuration(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs >= 86400) {
    return (seconds / 86400).toFixed(1) + 'd';
  }
  if (abs >= 3600) {
    return (seconds / 3600).toFixed(1) + 'h';
  }
  if (abs >= 60) {
    return (seconds / 60).toFixed(1) + 'm';
  }
  return seconds.toFixed(1) + 's';
}

/** Format a metric value using its format template, with time-unit detection */
/**
 * Format a metric value using its format template.
 * XSS safety: React JSX auto-escapes rendered text. The format.replace(<>) guard
 * prevents angle brackets from appearing even if rendered outside React in the future.
 */
function formatMetricValue(raw: number, format: string): string {
  const safeFormat = format.replace(/[<>]/g, '');
  // Detect time-unit format templates: "${value}s", "${value}ms", "${value}m", "${value}h"
  const timeMatch = safeFormat.match(/\$\{value\}(ms|s|m|h)$/);
  if (timeMatch) {
    const unit = timeMatch[1];
    let seconds = raw;
    if (unit === 'ms') {
      seconds = raw / 1000;
    } else if (unit === 'm') {
      seconds = raw * 60;
    } else if (unit === 'h') {
      seconds = raw * 3600;
    }
    return formatDuration(seconds);
  }
  return safeFormat.replace('${value}', formatNumber(raw));
}
