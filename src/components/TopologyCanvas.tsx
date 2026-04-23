import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import {
  TopologyNode, TopologyEdge, NodeGroup,
  NodeRuntimeState, EdgeRuntimeState, TopologyPanelOptions,
  NODE_TYPE_CONFIG, STATUS_COLORS, ACCENT_COLOR
} from '../types';
import { getAnchorPoint, getBezierPath, getBezierMidpoint, EDGE_TYPE_STYLES } from '../utils/edges';
import { ViewportState, DEFAULT_VIEWPORT, zoomAtPoint, fitToView } from '../utils/viewport';
import { getStoredViewport, setStoredViewport } from '../utils/viewportStore';

interface CanvasProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  groups: NodeGroup[];
  nodePositions: Map<string, { x: number; y: number }>;
  nodeStates: Map<string, NodeRuntimeState>;
  edgeStates: Map<string, EdgeRuntimeState>;
  canvasOptions: TopologyPanelOptions['canvas'];
  animationOptions: TopologyPanelOptions['animation'];
  displayOptions: TopologyPanelOptions['display'];
  width: number;
  height: number;
  panelId: number;
  onNodeDrag: (nodeId: string, x: number, y: number) => void;
  onNodeToggle: (nodeId: string, rect?: DOMRect) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  // Context-menu callbacks. Raw clientX/clientY are passed through —
  // TopologyPanel converts to panel-relative coordinates so it can clamp the
  // menu against its own bounds, consistent with the existing popup path.
  onNodeContextMenu?: (nodeId: string, clientX: number, clientY: number) => void;
  onEdgeContextMenu?: (edgeId: string, clientX: number, clientY: number) => void;
  // Edge left-click. Same raw-coord convention as the context-menu
  // handlers above. Routed through the hit-test overlay.
  onEdgeClick?: (edgeId: string, clientX: number, clientY: number) => void;
  // Drag-to-connect. Fires when the user Shift+drags from one node
  // to another. TopologyPanel validates + appends a new edge via
  // onOptionsChange. Only wired when isEditMode is true.
  onEdgeCreate?: (sourceId: string, targetId: string) => void;
  /** True when the panel is rendered inside Grafana's panel editor chrome. */
  isEditMode?: boolean;
}

// ─── Memoized edge SVG renderer ───
//
// Extracted into its own component so React.memo's default shallow
// comparison can skip re-rendering individual edges when edgeStates
// ticks but that particular edge's computed state (color, thickness,
// flowSpeed, label) is unchanged. Props are intentionally flattened
// into primitives so shallow compare hits cleanly — the edgeStates
// Map rebuilds on every parent render and would otherwise blow the
// comparison if passed as an object.
interface EdgeRenderProps {
  edgeId: string;
  bidirectional: boolean;
  isResponse: boolean;
  latencyLabel?: string;
  dashArray: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  midX: number;
  midY: number;
  edgeColor: string;
  thickness: number;
  flowSpeed: number;
  label?: string;
  showEdgeLabels: boolean;
  arrowId: string;
  // When any edge is hovered, every other edge receives isDimmed=true and
  // fades to 20% opacity with its flow animation paused. This gives users
  // a focus-mode read on dense topologies without a click or persisted state.
  isDimmed: boolean;
  // False when the user has prefers-reduced-motion set — skips the 180ms
  // opacity fade so the dim change snaps instead of animating.
  transitionOpacity: boolean;
}

const EdgeRender: React.FC<EdgeRenderProps> = React.memo((props) => {
  const {
    bidirectional, isResponse, latencyLabel, dashArray,
    fromX, fromY, toX, toY, midX, midY,
    edgeColor, thickness, flowSpeed, label, showEdgeLabels, arrowId,
    isDimmed, transitionOpacity,
  } = props;
  const from = { x: fromX, y: fromY };
  const to = { x: toX, y: toY };
  const renderFrom = isResponse ? to : from;
  const renderTo = isResponse ? from : to;
  const renderPath = getBezierPath(renderFrom, renderTo);
  const renderColor = isResponse ? ACCENT_COLOR : edgeColor;
  const dimFactor = isDimmed ? 0.2 : 1;
  const opacityTransition: string | undefined = transitionOpacity ? 'opacity 180ms ease-out' : undefined;
  const flowAnimationState: 'paused' | 'running' = isDimmed ? 'paused' : 'running';
  return (
    <g>
      {/* Base wire */}
      <path
        d={renderPath}
        fill="none"
        stroke={isResponse ? '#2d374899' : '#2d3748'}
        strokeWidth={thickness}
        strokeDasharray={dashArray}
        markerEnd={`url(#${arrowId})`}
        opacity={dimFactor}
        style={{ transition: opacityTransition }}
      />
      {/* Animated flow overlay — the moving coloured dashes that trace the
          traffic direction. The SVG drop-shadow filter gives it a neon-glow
          halo around the stroke, so healthy green edges pulse softly and
          critical red edges broadcast the failure much harder. */}
      {flowSpeed > 0 && (
        <path
          d={renderPath}
          fill="none"
          stroke={renderColor}
          strokeWidth={Math.max(thickness + 1, 2.5)}
          strokeDasharray="6 10"
          opacity={(isResponse ? 0.4 : 0.55) * dimFactor}
          style={{
            animation: `topoFlow ${flowSpeed}s linear infinite`,
            animationPlayState: flowAnimationState,
            filter: `drop-shadow(0 0 3px ${renderColor}) drop-shadow(0 0 6px ${renderColor})`,
            transition: opacityTransition,
          }}
        />
      )}
      {/* Bidirectional reverse path */}
      {bidirectional && (
        <>
          <path
            d={getBezierPath(to, from)}
            fill="none"
            stroke="#2d3748"
            strokeWidth={thickness}
            strokeDasharray={dashArray}
            markerEnd={`url(#${arrowId})`}
            opacity={0.5 * dimFactor}
            style={{ transition: opacityTransition }}
          />
          {flowSpeed > 0 && (
            <path
              d={getBezierPath(to, from)}
              fill="none"
              stroke={edgeColor}
              strokeWidth={Math.max(thickness + 1, 2.5)}
              strokeDasharray="6 10"
              opacity={0.35 * dimFactor}
              style={{
                animation: `topoFlow ${flowSpeed}s linear infinite`,
                animationPlayState: flowAnimationState,
                filter: `drop-shadow(0 0 3px ${edgeColor}) drop-shadow(0 0 6px ${edgeColor})`,
                transition: opacityTransition,
              }}
            />
          )}
        </>
      )}
      {/* Edge label */}
      {showEdgeLabels && label && (
        <text
          x={midX}
          y={midY - 4}
          textAnchor="middle"
          fontSize={9}
          fill="#5e81ac"
          fontFamily="var(--font-sans)"
        >
          {label}
        </text>
      )}
      {/* Secondary latency label */}
      {showEdgeLabels && latencyLabel && (
        <text
          x={midX}
          y={label ? midY + 8 : midY - 4}
          textAnchor="middle"
          fontSize={8}
          fill="#616e88"
          fontFamily="var(--font-sans)"
        >
          {latencyLabel}
        </text>
      )}
    </g>
  );
});
EdgeRender.displayName = 'EdgeRender';

export const TopologyCanvas: React.FC<CanvasProps> = ({
  nodes, edges, groups, nodePositions, nodeStates, edgeStates,
  canvasOptions, animationOptions, displayOptions,
  width, height, panelId, onNodeDrag, onNodeToggle, onNodeDoubleClick,
  onNodeContextMenu, onEdgeContextMenu, onEdgeClick, onEdgeCreate, isEditMode,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [dragging, setDragging] = useState<{ nodeId: string; offX: number; offY: number } | null>(null);
  const hasMovedRef = useRef(false);

  // Edge hover state: when non-null, every OTHER edge renders
  // dimmed to 20% opacity with its flow animation paused. The value is the
  // id of the currently hovered edge, cleared on mouseleave.
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Drag-to-connect state. Split into two states so the document
  // listener useEffect only re-registers on start/stop, not on every cursor
  // movement (setConnectingCursor ticks per pointermove). Mutually exclusive
  // with `dragging` — the inline pointerdown branch picks one.
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null);
  const [connectingCursor, setConnectingCursor] = useState<{ x: number; y: number } | null>(null);
  // prefers-reduced-motion is read once on mount — if the user toggles it
  // live we'd need a matchMedia listener, but that's rare enough to skip.
  const prefersReducedMotionRef = useRef<boolean>(
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );

  // Viewport zoom/pan state — initial value is read from the module-level
  // store so toggling edit/view mode (which remounts the whole panel) does
  // not reset pan/zoom. Every update is mirrored back into the store.
  const [viewport, setViewport] = useState<ViewportState>(
    () => getStoredViewport(panelId) || DEFAULT_VIEWPORT
  );
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  useEffect(() => {
    setStoredViewport(panelId, viewport);
  }, [panelId, viewport]);
  // No cleanup: React effect cleanups fire on every unmount — including the
  // edit/view toggle remount we specifically want to survive. A cleanup here
  // would clear the store and defeat the whole purpose of viewportStore.
  // We accept the bounded leak of one entry per unique panelId the user has
  // ever opened in this browser session.
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  // Mouse wheel zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {return;}
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      setViewport((prev) => zoomAtPoint(prev, e.deltaY, cursorX, cursorY));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Middle-mouse or Ctrl+drag pan
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      setIsPanning(true);
      const vp = viewportRef.current;
      panStartRef.current = { x: e.clientX, y: e.clientY, tx: vp.translateX, ty: vp.translateY };
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    if (!isPanning) {return;}
    const handleMove = (e: PointerEvent) => {
      // Snapshot ref fields BEFORE scheduling setViewport. React 18 batches
      // the updater lambda so it can run after handleUp has already nulled
      // panStartRef.current (observable under act() batching; latent under
      // concurrent rendering). Closing over primitives avoids the deref.
      const start = panStartRef.current;
      if (!start) {return;}
      const { x, y, tx, ty } = start;
      const dx = e.clientX - x;
      const dy = e.clientY - y;
      setViewport((prev) => ({ ...prev, translateX: tx + dx, translateY: ty + dy }));
    };
    const handleUp = () => { setIsPanning(false); panStartRef.current = null; };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => { document.removeEventListener('pointermove', handleMove); document.removeEventListener('pointerup', handleUp); };
  }, [isPanning]);

  // Fit-to-view: compute and set viewport to show all nodes
  const handleFitToView = useCallback(() => {
    const widths = new Map<string, number>();
    nodes.forEach((n) => { widths.set(n.id, n.width || (n.compact ? 110 : 180)); });
    setViewport(fitToView(nodePositions, widths, width, height));
  }, [nodePositions, nodes, width, height]);

  // Auto fit-to-view on first render (when nodes load for the first time).
  // Skip auto-fit if the panel already has a stored viewport — the user
  // either previously fitted and then panned/zoomed, or the panel was
  // remounted (edit/view mode toggle) and their pan/zoom must survive.
  const prevNodeCountRef = useRef(0);
  const hadStoredViewportRef = useRef(getStoredViewport(panelId) !== undefined);
  const autoFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (
      prevNodeCountRef.current === 0 &&
      nodes.length > 0 &&
      !hadStoredViewportRef.current
    ) {
      autoFitTimerRef.current = setTimeout(handleFitToView, 100);
    }
    prevNodeCountRef.current = nodes.length;
    return () => { if (autoFitTimerRef.current) { clearTimeout(autoFitTimerRef.current); } };
  }, [nodes.length, handleFitToView]);

  const onNodeDragRef = useRef(onNodeDrag);
  onNodeDragRef.current = onNodeDrag;

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    const pos = nodePositions.get(nodeId);
    if (!pos) {return;}
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {return;}
    // Inverse-transform pointer coords by viewport for correct drag at any zoom level
    const vp = viewportRef.current;
    const scale = vp.scale || 1;
    const worldX = (e.clientX - rect.left - vp.translateX) / scale;
    const worldY = (e.clientY - rect.top - vp.translateY) / scale;
    setDragging({
      nodeId,
      offX: worldX - pos.x,
      offY: worldY - pos.y,
    });
    hasMovedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, [nodePositions]);

  useEffect(() => {
    if (!dragging) {return;}

    const handleMove = (e: PointerEvent) => {
      hasMovedRef.current = true;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {return;}
      // Inverse-transform pointer coords by viewport (use ref to avoid stale closure)
      const vp = viewportRef.current;
      const scale = vp.scale || 1;
      const worldX = (e.clientX - rect.left - vp.translateX) / scale;
      const worldY = (e.clientY - rect.top - vp.translateY) / scale;
      let x = worldX - dragging.offX;
      let y = worldY - dragging.offY;
      x = Math.max(0, Math.min(width / scale - 100, x));
      y = Math.max(0, Math.min(height / scale - 40, y));
      onNodeDragRef.current(dragging.nodeId, x, y);
    };

    const handleUp = () => setDragging(null);

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, [dragging, width, height]);

  const handleNodeClick = useCallback((nodeId: string, rect?: DOMRect) => {
    if (!hasMovedRef.current) {
      onNodeToggle(nodeId, rect);
    }
  }, [onNodeToggle]);

  // Drag-to-connect listeners. Attached only while a connect gesture
  // is active. pointermove updates the rubber-band cursor; pointerup hit-tests
  // the cursor position against node rects and creates a new edge if it lands
  // on a non-source, non-virtual node. Escape cancels without creating.
  useEffect(() => {
    if (!connectingSourceId) { return; }
    const clearConnecting = () => {
      setConnectingSourceId(null);
      setConnectingCursor(null);
    };
    const toWorld = (e: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) { return null; }
      const vp = viewportRef.current;
      const scale = vp.scale || 1;
      return {
        x: (e.clientX - rect.left - vp.translateX) / scale,
        y: (e.clientY - rect.top - vp.translateY) / scale,
      };
    };
    const handleMove = (e: PointerEvent) => {
      const w = toWorld(e);
      if (w) { setConnectingCursor(w); }
    };
    const handleUp = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== -1) { clearConnecting(); return; }
      const w = toWorld(e);
      if (!w) { clearConnecting(); return; }
      // Hit-test: find the first node whose world-space rect contains the
      // cursor. Skip virtual nodes (runtime-only, not persisted to options)
      // and the source node itself (self-loops disallowed in this UI).
      let targetId: string | null = null;
      for (const node of nodes) {
        if (node._virtual) { continue; }
        if (node.id === connectingSourceId) { continue; }
        const pos = nodePositions.get(node.id);
        if (!pos) { continue; }
        const el = nodeElRefs.current.get(node.id);
        const width = el?.offsetWidth || node.width || (node.compact ? 110 : 180);
        const height = el?.offsetHeight || (node.compact ? 60 : 90);
        if (w.x >= pos.x && w.x <= pos.x + width && w.y >= pos.y && w.y <= pos.y + height) {
          targetId = node.id;
          break;
        }
      }
      if (targetId && onEdgeCreate) {
        onEdgeCreate(connectingSourceId, targetId);
      }
      clearConnecting();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { clearConnecting(); }
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('keydown', handleKey);
    };
  }, [connectingSourceId, nodes, nodePositions, onEdgeCreate]);

  // Pre-computed node lookup map for O(1) access in edge rendering (CR-11)
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Pre-computed parallel edge map to avoid O(E²) in render path (CR-12)
  const parallelEdgeMap = useMemo(() => {
    const map = new Map<string, TopologyEdge[]>();
    edges.forEach((e) => {
      if (!e.targetId) { return; }
      const key = [e.sourceId, e.targetId].sort().join('-');
      if (!map.has(key)) { map.set(key, []); }
      map.get(key)!.push(e);
    });
    return map;
  }, [edges]);

  // Get node rect for edge calculations (uses scoped ref map, not global DOM)
  const getNodeRect = (nodeId: string) => {
    const pos = nodePositions.get(nodeId);
    const node = nodeById.get(nodeId);
    if (!pos || !node) {return null;}
    const el = nodeElRefs.current.get(nodeId);
    const w = el?.offsetWidth || node.width || (node.compact ? 110 : 180);
    const h = el?.offsetHeight || (node.compact ? 60 : 90);
    return { x: pos.x, y: pos.y, w, h };
  };

  // Consolidated per-edge geometry. Both the visual edge SVG layer and the
  // invisible hit-test overlay below consume this map so the two layers can
  // never diverge (a single bezier computed once, shared by both). Computed
  // inline (not memoized) so it always reflects the latest measured node
  // offsetWidth/offsetHeight from the ref map — matching the prior per-render
  // behaviour of the visual edges.map loop.
  type EdgeGeometry = {
    fromX: number; fromY: number; toX: number; toY: number;
    midX: number; midY: number; renderPath: string;
    thickness: number; isResponse: boolean;
  };
  const edgeGeometry = new Map<string, EdgeGeometry>();
  for (const edge of edges) {
    const sourceRect = getNodeRect(edge.sourceId);
    const targetId = edge.targetId;
    if (!sourceRect || !targetId) { continue; }
    const targetRect = getNodeRect(targetId);
    if (!targetRect) { continue; }

    const pairKey = [edge.sourceId, targetId].sort().join('-');
    const parallelEdges = parallelEdgeMap.get(pairKey) || [edge];
    const parallelIndex = parallelEdges.indexOf(edge);
    const parallelOffset = parallelEdges.length > 1
      ? (parallelIndex - (parallelEdges.length - 1) / 2) * 15
      : 0;

    const fromRaw = getAnchorPoint(sourceRect, edge.anchorSource, targetRect);
    const toRaw = getAnchorPoint(targetRect, edge.anchorTarget, sourceRect);
    const dx = toRaw.x - fromRaw.x;
    const dy = toRaw.y - fromRaw.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const fromX = fromRaw.x + nx * parallelOffset;
    const fromY = fromRaw.y + ny * parallelOffset;
    const toX = toRaw.x + nx * parallelOffset;
    const toY = toRaw.y + ny * parallelOffset;
    const mid = getBezierMidpoint({ x: fromX, y: fromY }, { x: toX, y: toY });

    const es = edgeStates.get(edge.id);
    const thickness = es?.thickness || edge.thicknessMin;
    const isResponse = edge.type === 'response';
    const from = { x: fromX, y: fromY };
    const to = { x: toX, y: toY };
    const renderFrom = isResponse ? to : from;
    const renderTo = isResponse ? from : to;
    const renderPath = getBezierPath(renderFrom, renderTo);

    edgeGeometry.set(edge.id, {
      fromX, fromY, toX, toY, midX: mid.x, midY: mid.y, renderPath, thickness, isResponse,
    });
  }

  // Grid background
  const gridStyle = canvasOptions.showGrid ? {
    backgroundImage: `radial-gradient(circle at 1px 1px, #2d374833 1px, transparent 0)`,
    backgroundSize: `${canvasOptions.gridSize}px ${canvasOptions.gridSize}px`,
  } : {};

  return (
    <div
      ref={canvasRef}
      className="topology-canvas"
      style={{
        width,
        height,
        position: 'relative',
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : connectingSourceId ? 'crosshair' : 'default',
        ...gridStyle,
      }}
      onPointerDown={handleCanvasPointerDown}
    >
      {/* Viewport transform wrapper */}
      <div style={{ transform: `translate(${viewport.translateX}px, ${viewport.translateY}px) scale(${viewport.scale})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      {/* SVG Layer for edges */}
      <svg
        // overflow: visible is CRITICAL — SVG root elements default to
        // overflow: hidden (unlike <div>), so any edge path that extends
        // beyond the SVG's layout box gets clipped. After Auto Layout +
        // Fit, nodes can end up at coordinates outside the original
        // canvas bounds (HTML node divs render fine because divs default
        // to overflow: visible, but SVG paths were silently clipped).
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 1 }}
      >
        <defs>
          <marker id="topo-arrow-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 2L8 5L2 8" fill="none" stroke="#2d3748" strokeWidth="1.5" strokeLinecap="round" />
          </marker>
          <marker id="topo-arrow-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 2L8 5L2 8" fill="none" stroke="#a3be8c" strokeWidth="1.5" strokeLinecap="round" />
          </marker>
          <marker id="topo-arrow-warn" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 2L8 5L2 8" fill="none" stroke="#ebcb8b" strokeWidth="1.5" strokeLinecap="round" />
          </marker>
          <marker id="topo-arrow-crit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 2L8 5L2 8" fill="none" stroke="#bf616a" strokeWidth="1.5" strokeLinecap="round" />
          </marker>
          <marker id="topo-arrow-response" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 2L8 5L2 8" fill="none" stroke="#5e81ac" strokeWidth="1.5" strokeLinecap="round" />
          </marker>
        </defs>

        {/* Edges — reads geometry from the shared edgeGeometry map computed
            above so this layer and the hit-test overlay below can never
            diverge. */}
        {edges.map((edge) => {
          const geom = edgeGeometry.get(edge.id);
          if (!geom) { return null; }
          const edgeStyle = EDGE_TYPE_STYLES[edge.type] || EDGE_TYPE_STYLES.traffic;
          const es = edgeStates.get(edge.id);
          const edgeColor = es?.color || STATUS_COLORS.nodata;
          const flowSpeed = es?.animationSpeed || 0;
          const label = es?.formattedLabel;
          const arrowId = geom.isResponse ? 'topo-arrow-response'
            : edgeColor === STATUS_COLORS.critical ? 'topo-arrow-crit'
            : edgeColor === STATUS_COLORS.warning ? 'topo-arrow-warn'
            : edgeColor === STATUS_COLORS.ok ? 'topo-arrow-ok'
            : 'topo-arrow-dim';

          return (
            <EdgeRender
              key={edge.id}
              edgeId={edge.id}
              bidirectional={edge.bidirectional}
              isResponse={geom.isResponse}
              latencyLabel={edge.latencyLabel}
              dashArray={edgeStyle.dashArray}
              fromX={geom.fromX}
              fromY={geom.fromY}
              toX={geom.toX}
              toY={geom.toY}
              midX={geom.midX}
              midY={geom.midY}
              edgeColor={edgeColor}
              thickness={geom.thickness}
              flowSpeed={flowSpeed}
              label={label}
              showEdgeLabels={displayOptions.showEdgeLabels}
              arrowId={arrowId}
              isDimmed={hoveredEdgeId !== null && hoveredEdgeId !== edge.id}
              transitionOpacity={!prefersReducedMotionRef.current}
            />
          );
        })}

        {/* Rubber-band bezier for drag-to-connect. Rendered inside
            the visual edge SVG so it inherits pointerEvents:none and can't
            intercept the in-progress drag. Uses an auto source anchor
            aimed at the cursor (fake 1x1 target rect) so the start point
            sits on the correct face of the source node. */}
        {connectingSourceId && connectingCursor && (() => {
          const sourcePos = nodePositions.get(connectingSourceId);
          const sourceNode = nodeById.get(connectingSourceId);
          if (!sourcePos || !sourceNode) { return null; }
          const sourceEl = nodeElRefs.current.get(connectingSourceId);
          const sw = sourceEl?.offsetWidth || sourceNode.width || (sourceNode.compact ? 110 : 180);
          const sh = sourceEl?.offsetHeight || (sourceNode.compact ? 60 : 90);
          const sourceRect = { x: sourcePos.x, y: sourcePos.y, w: sw, h: sh };
          const targetRect = { x: connectingCursor.x, y: connectingCursor.y, w: 1, h: 1 };
          const fromAnchor = getAnchorPoint(sourceRect, 'auto', targetRect);
          const to = { x: connectingCursor.x, y: connectingCursor.y };
          const path = getBezierPath(fromAnchor, to);
          return (
            <g>
              <path
                d={path}
                fill="none"
                stroke={ACCENT_COLOR}
                strokeWidth={2}
                strokeDasharray="6 6"
                opacity={0.8}
              />
              <circle cx={to.x} cy={to.y} r={4} fill={ACCENT_COLOR} opacity={0.9} />
            </g>
          );
        })()}
      </svg>

      {/* Edge hit-test layer — invisible wide strokes receive pointer events.
          The visual edge layer above stays pointerEvents:none; all edge
          interactions route through this layer. zIndex: 2 puts it between
          the visual SVG (1) and HTML node divs (also 2; divs win at equal
          z-index due to paint order). pointerEvents flips to 'none' during
          a node drag so a fast cursor cannot hit-test an edge mid-drag. */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: (dragging || connectingSourceId) ? 'none' : 'auto',
          zIndex: 2,
        }}
      >
        {edges.map((edge) => {
          const geom = edgeGeometry.get(edge.id);
          if (!geom) { return null; }
          return (
            <path
              key={`hit-${edge.id}`}
              d={geom.renderPath}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(geom.thickness + 12, 16)}
              data-edge-id={edge.id}
              data-testid={`edge-hit-${edge.id}`}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onMouseEnter={() => setHoveredEdgeId(edge.id)}
              onMouseLeave={() => setHoveredEdgeId(null)}
              onContextMenu={(e) => {
                if (!onEdgeContextMenu) { return; }
                e.preventDefault();
                e.stopPropagation();
                onEdgeContextMenu(edge.id, e.clientX, e.clientY);
              }}
              onClick={(e) => {
                if (!onEdgeClick) { return; }
                e.stopPropagation();
                onEdgeClick(edge.id, e.clientX, e.clientY);
              }}
            />
          );
        })}
      </svg>

      {/* Group containers */}
      {groups.map((group) => {
        const memberPositions = group.nodeIds
          .map((id) => {
            const pos = nodePositions.get(id);
            const node = nodeById.get(id);
            if (!pos || !node) {return null;}
            const w = node.width || (node.compact ? 110 : 180);
            const h = 90;
            return { x: pos.x, y: pos.y, w, h };
          })
          .filter(Boolean) as Array<{ x: number; y: number; w: number; h: number }>;

        if (memberPositions.length === 0) {return null;}

        const padding = 15;
        const minX = Math.min(...memberPositions.map((p) => p.x)) - padding;
        const minY = Math.min(...memberPositions.map((p) => p.y)) - padding - 10;
        const maxX = Math.max(...memberPositions.map((p) => p.x + p.w)) + padding;
        const maxY = Math.max(...memberPositions.map((p) => p.y + p.h)) + padding;

        return (
          <div
            key={group.id}
            className="topology-group"
            style={{
              position: 'absolute',
              left: minX,
              top: minY,
              width: maxX - minX,
              height: maxY - minY,
              border: group.style === 'dashed' ? '1px dashed #2d374866' : group.style === 'solid' ? '1px solid #2d374844' : 'none',
              borderRadius: 10,
              // zIndex 0 puts group rectangles BEHIND the SVG edge layer
              // (zIndex 1). Otherwise edges whose bezier path exits the
              // group's bounding box get hidden behind the group's own
              // transparent div — an easy way to lose traffic flow lines
              // on any service that lives inside a cluster/ha_pair group.
              zIndex: 0,
              pointerEvents: 'none',
            }}
          >
            <span className="topology-group-label">{group.label}</span>
          </div>
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) {return null;}
        const state = nodeStates.get(node.id);
        const typeConfig = NODE_TYPE_CONFIG[node.type];
        const isExpanded = state?.expanded || false;
        const isDragging = dragging?.nodeId === node.id;
        const status = state?.status || 'unknown';

        const summaryMetrics = node.metrics.filter((m) => m.isSummary).slice(0, displayOptions.maxSummaryMetrics);
        const expandedMetrics = node.metrics.filter((m) => !m.isSummary);
        const sections = [...new Set(expandedMetrics.map((m) => m.section))];

        return (
          <div
            key={node.id}
            ref={(el) => { if (el) {nodeElRefs.current.set(node.id, el);} else {nodeElRefs.current.delete(node.id);} }}
            className={`topology-node ${node.compact ? 'compact' : ''} st-${status} ${isExpanded ? 'open' : ''} ${isDragging ? 'dragging' : ''}`}
            role="button"
            aria-label={`${node.name} (${node.type}): ${status}`}
            title={node.name}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              width: node.width || (node.compact ? 110 : 180),
              zIndex: isDragging ? 10 : 2,
            }}
            onPointerDown={(e) => {
              // Shift+pointerdown in edit mode enters drag-to-connect mode
              // instead of normal node drag. Virtual nodes are runtime-only
              // and can't participate (they have no persisted slice entry).
              if (isEditMode && e.shiftKey && e.button === 0 && !node._virtual && onEdgeCreate) {
                const canvasRect = canvasRef.current?.getBoundingClientRect();
                if (!canvasRect) { return; }
                const vp = viewportRef.current;
                const scale = vp.scale || 1;
                const worldX = (e.clientX - canvasRect.left - vp.translateX) / scale;
                const worldY = (e.clientY - canvasRect.top - vp.translateY) / scale;
                // Mark this gesture as a "move" so the click event that
                // bubbles from pointerup doesn't open a node popup on the
                // target (or the source, for a self-drag-cancel). Cleared
                // automatically on the next normal pointerdown via
                // handlePointerDown.
                hasMovedRef.current = true;
                setConnectingSourceId(node.id);
                setConnectingCursor({ x: worldX, y: worldY });
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              if (node._virtual && isEditMode && e.shiftKey) {
                console.warn('[topology] drag-to-connect not supported from virtual (runtime-only) nodes', { nodeId: node.id });
                return;
              }
              handlePointerDown(e, node.id);
            }}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              handleNodeClick(node.id, rect);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onNodeDoubleClick?.(node.id);
            }}
            onContextMenu={(e) => {
              if (!onNodeContextMenu) { return; }
              e.preventDefault();
              e.stopPropagation();
              onNodeContextMenu(node.id, e.clientX, e.clientY);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                handleNodeClick(node.id, rect);
              }
            }}
          >
            {/* Header */}
            <div className="topo-node-header">
              <div
                className="topo-node-icon"
                style={{
                  background: (node.colorOverride || typeConfig.color) + '22',
                  color: node.colorOverride || typeConfig.color,
                }}
              >
                {node.iconOverride || typeConfig.icon}
              </div>
              <div className="topo-node-info">
                <div className="topo-node-name">{node.name}</div>
                {node.role && <div className="topo-node-role">{node.role}</div>}
              </div>
              {displayOptions.showNodeStatus && (
                <>
                  <div className={`topo-node-dot ${status}${status === 'critical' && !animationOptions.pulseOnCritical ? ' no-pulse' : ''}`} />
                  {/* Defense-in-depth for screen readers: the node's
                      aria-label already announces status, but a
                      visually-hidden sibling next to the color-only dot
                      means a colorblind user hovering a single card
                      with a magnifier still gets a text label. */}
                  <span className="sr-only">{status}</span>
                </>
              )}
            </div>

            {/* Summary metrics (always visible) */}
            <div className="topo-node-metrics">
              {summaryMetrics.map((metric) => {
                const val = state?.metricValues[metric.id];
                return (
                  <div key={metric.id} className="topo-metric">
                    <div className="topo-metric-label">{metric.label}</div>
                    <div className={`topo-metric-value ${val?.status || 'unknown'}`}>
                      {val?.formatted || 'N/A'}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Expand hint */}
            {expandedMetrics.length > 0 && !isExpanded && (
              <div className="topo-node-hint">click to expand</div>
            )}

            {/* Expanded metrics */}
            {expandedMetrics.length > 0 && (
              <div className="topo-node-expanded">
                <div className="topo-node-expanded-inner">
                  {sections.map((section) => (
                    <React.Fragment key={section}>
                      <div className="topo-exp-section">{section}</div>
                      <div className="topo-exp-row">
                        {expandedMetrics
                          .filter((m) => m.section === section)
                          .map((metric) => {
                            const val = state?.metricValues[metric.id];
                            return (
                              <div key={metric.id} className="topo-metric">
                                <div className="topo-metric-label">{metric.label}</div>
                                <div className={`topo-metric-value ${val?.status || 'unknown'}`}>
                                  {val?.formatted || 'N/A'}
                                </div>
                                {val?.sparklineData && (
                                  <div className="topo-sparkline">
                                    {val.sparklineData.map((v, i) => (
                                      <div
                                        key={i}
                                        className="topo-spark-bar"
                                        style={{
                                          height: `${Math.max(5, (v / Math.max(...val.sparklineData!, 1)) * 100)}%`,
                                          background: STATUS_COLORS[val.status] || ACCENT_COLOR,
                                        }}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      </div>{/* end viewport transform wrapper */}
      {/* Popup rendered in TopologyPanel instead (outside canvas overflow:hidden) */}
      {/* Zoom controls overlay */}
      <div style={{ position: 'absolute', bottom: 6, right: 6, display: 'flex', gap: 3, zIndex: 20 }}>
        <button className="topology-btn" onClick={handleFitToView} title="Fit to view">Fit</button>
        <button className="topology-btn" onClick={() => setViewport(DEFAULT_VIEWPORT)} title="Reset zoom">1:1</button>
      </div>
    </div>
  );
};
