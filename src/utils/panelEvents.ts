/**
 * panelEvents.ts — tiny cross-subtree pub/sub for the topology plugin
 *
 * The panel and its editor live in different React subtrees (the panel renders
 * inside Grafana's dashboard, the editor renders inside Grafana's panel-editor
 * chrome). React Context cannot cross this boundary. A module-level singleton
 * does.
 *
 * Used to let the canvas tell the sidebar NodesEditor "this node was clicked —
 * auto-expand its card" WITHOUT round-tripping through onOptionsChange (which
 * would dirty the dashboard JSON on every click).
 *
 * Keep this file tiny and focused. Add new event types only when absolutely
 * required.
 */

import { TopologyPanelOptions } from '../types';

/** Sub-sections of the NodeCard that a section-targeted edit request can open. */
export type NodeEditSection = 'metrics' | 'advanced' | 'alertMatchers' | 'observabilityLinks';

/** Sub-sections of the EdgeCard that a section-targeted edit request can open. */
export type EdgeEditSection = 'metric' | 'thresholds' | 'stateMap' | 'visual';

type NodeClickHandler = (nodeId: string) => void;
type NodeEditRequestHandler = (nodeId: string, section?: NodeEditSection) => void;
type EdgeEditRequestHandler = (edgeId: string, section?: EdgeEditSection) => void;
type TopologyImportHandler = (payload: Partial<TopologyPanelOptions>) => void;

const nodeClickSubscribers = new Set<NodeClickHandler>();
const nodeEditRequestSubscribers = new Set<NodeEditRequestHandler>();
const edgeEditRequestSubscribers = new Set<EdgeEditRequestHandler>();
const orphanEdgeCleanupSubscribers = new Set<NodeClickHandler>();
const topologyImportSubscribers = new Set<TopologyImportHandler>();

/**
 * Publish a node-clicked event to all subscribers.
 * Called by TopologyPanel when a node is clicked in edit mode.
 */
export function emitNodeClicked(nodeId: string): void {
  nodeClickSubscribers.forEach((handler) => {
    try {
      handler(nodeId);
    } catch (err) {
      console.warn('[topology] panelEvents handler threw', err);
    }
  });
}

/**
 * Subscribe to node-clicked events.
 * Returns an unsubscribe function — call it in your useEffect cleanup.
 */
export function onNodeClicked(handler: NodeClickHandler): () => void {
  nodeClickSubscribers.add(handler);
  return () => {
    nodeClickSubscribers.delete(handler);
  };
}

/**
 * Publish a node-edit-request event to all subscribers.
 * Called by TopologyPanel when a node is double-clicked. Semantically stronger
 * than a single click: "take me to this node in the editor" rather than "note
 * that I noticed this node." The NodesEditor subscriber scrolls the matching
 * card into view and expands it.
 */
export function emitNodeEditRequest(nodeId: string, section?: NodeEditSection): void {
  nodeEditRequestSubscribers.forEach((handler) => {
    try {
      handler(nodeId, section);
    } catch (err) {
      console.warn('[topology] panelEvents edit-request handler threw', err);
    }
  });
}

/**
 * Subscribe to node-edit-request events. The handler receives an
 * optional `section` hint so subscribers can open a specific
 * sub-section of the NodeCard (metrics, advanced, alertMatchers,
 * observabilityLinks). When undefined, only the whole card is opened —
 * backward-compatible with callers that don't care about targeting.
 *
 * Returns an unsubscribe function — call it in your useEffect cleanup.
 */
export function onNodeEditRequest(handler: NodeEditRequestHandler): () => void {
  nodeEditRequestSubscribers.add(handler);
  return () => {
    nodeEditRequestSubscribers.delete(handler);
  };
}

/**
 * Publish an edge-edit-request event. Fired by TopologyPanel when the user
 * asks to edit a specific edge from the canvas (right-click → Edit in
 * sidebar, or the Edit button on an edge popup). EdgesEditor subscribes and
 * scrolls the matching card into view + expands it — the mirror image of
 * onNodeEditRequest.
 */
export function emitEdgeEditRequest(edgeId: string, section?: EdgeEditSection): void {
  edgeEditRequestSubscribers.forEach((handler) => {
    try {
      handler(edgeId, section);
    } catch (err) {
      console.warn('[topology] panelEvents edge-edit-request handler threw', err);
    }
  });
}

/**
 * Subscribe to edge-edit-request events. The handler receives an
 * optional `section` hint so subscribers can open a specific
 * sub-section of the EdgeCard (metric, thresholds, stateMap, visual).
 *
 * Returns an unsubscribe function — call it in your useEffect cleanup.
 */
export function onEdgeEditRequest(handler: EdgeEditRequestHandler): () => void {
  edgeEditRequestSubscribers.add(handler);
  return () => {
    edgeEditRequestSubscribers.delete(handler);
  };
}

/**
 * Publish an orphan-edge-cleanup event. NodesEditor fires this after deleting
 * a node so the TopologyPanel (which owns the full options including the edges
 * slice) can remove any edges that referenced the deleted node. NodesEditor
 * itself only has StandardEditorProps<TopologyNode[]> and can't reach the
 * edges slice directly.
 */
export function emitOrphanEdgeCleanup(deletedNodeId: string): void {
  orphanEdgeCleanupSubscribers.forEach((handler) => {
    try {
      handler(deletedNodeId);
    } catch (err) {
      console.warn('[topology] panelEvents orphan-cleanup handler threw', err);
    }
  });
}

/**
 * Subscribe to orphan-edge-cleanup events.
 * Returns an unsubscribe function — call it in your useEffect cleanup.
 */
export function onOrphanEdgeCleanup(handler: NodeClickHandler): () => void {
  orphanEdgeCleanupSubscribers.add(handler);
  return () => {
    orphanEdgeCleanupSubscribers.delete(handler);
  };
}

/**
 * Publish a topology-import payload. NodesEditor fires this after parsing
 * a JSON export so the TopologyPanel (which owns the full options object)
 * can merge the payload into dashboard state via onOptionsChange. This is
 * the only way for the sidebar editor to write across slices it doesn't
 * own (edges, groups, canvas, animation, layout, display).
 */
export function emitTopologyImport(payload: Partial<TopologyPanelOptions>): void {
  topologyImportSubscribers.forEach((handler) => {
    try {
      handler(payload);
    } catch (err) {
      console.warn('[topology] panelEvents import handler threw', err);
    }
  });
}

/**
 * Subscribe to topology-import events.
 * Returns an unsubscribe function — call it in your useEffect cleanup.
 */
export function onTopologyImport(handler: TopologyImportHandler): () => void {
  topologyImportSubscribers.add(handler);
  return () => {
    topologyImportSubscribers.delete(handler);
  };
}
