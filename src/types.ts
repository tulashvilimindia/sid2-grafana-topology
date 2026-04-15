// ============================================================
// NODE TYPES
// ============================================================

export type NodeType = 'cloudflare' | 'firewall' | 'loadbalancer' | 'virtualserver' | 'pool' | 'server' | 'database' | 'cache' | 'queue' | 'alb' | 'nlb' | 'nat' | 'kubernetes' | 'accelerator' | 'logs' | 'probe' | 'custom';
export type NodeStatus = 'ok' | 'warning' | 'critical' | 'unknown' | 'nodata';

export interface NodeMetricConfig {
  /** Stable internal id used as React key, self-query map key, and fallback frame-matcher. Auto-generated. */
  id: string;
  /** Display label (e.g. "cpu", "rps", "sessions") */
  label: string;
  /**
   * Optional explicit Grafana panel query refId for matching against `data.series` frames.
   * When set, takes precedence over `id` for frame matching — use this when the user
   * adds a Grafana panel query with a specific refId (e.g. "A", "error_rate") that needs
   * to drive this metric. When omitted, the matcher falls back to `id` then `label`.
   */
  refId?: string;
  /** Datasource uid */
  datasourceUid: string;
  /** Query expression */
  query: string;
  /** Format string for value display: "${value}%", "${value} rps" */
  format: string;
  /** Section this metric belongs to in expanded view */
  section: string;
  /** Whether this is a "summary" metric shown in collapsed view (max 4) */
  isSummary: boolean;
  /** Threshold breakpoints */
  thresholds: ThresholdStep[];
  /** Show sparkline in expanded view */
  showSparkline: boolean;
  /** Extra config for non-Prometheus datasources (CloudWatch dimensions, Infinity URL/rootSelector) */
  queryConfig?: DatasourceQueryConfig;
}

/** Configuration for non-Prometheus datasource queries */
export interface DatasourceQueryConfig {
  /** CloudWatch: namespace (e.g. "AWS/ApplicationELB") */
  namespace?: string;
  /** CloudWatch: metric name (e.g. "RequestCount") */
  metricName?: string;
  /** CloudWatch: dimensions (e.g. {"LoadBalancer": "app/my-alb/abc123"}) */
  dimensions?: Record<string, string>;
  /** CloudWatch: stat (e.g. "Sum", "Average") */
  stat?: string;
  /** CloudWatch: period in seconds */
  period?: number;
  /** Infinity: URL to query */
  url?: string;
  /** Infinity: JSON root selector (e.g. "data.viewer.zones.0.httpRequestsAdaptiveGroups") */
  rootSelector?: string;
  /** Infinity: HTTP method */
  method?: string;
  /** Infinity: POST body */
  body?: string;
}

export interface ThresholdStep {
  value: number;
  color: 'green' | 'yellow' | 'red';
}

export interface TopologyNode {
  /** Unique node identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short role/description */
  role: string;
  /** Node type - determines icon and default color */
  type: NodeType;
  /** Metric configurations */
  metrics: NodeMetricConfig[];
  /** Position on canvas */
  position: { x: number; y: number };
  /** Fixed width (optional, auto-calculated if not set) */
  width?: number;
  /** Group this node belongs to (e.g. "ha-paloalto") */
  groupId?: string;
  /** Whether this node is compact (mini node for dense clusters) */
  compact: boolean;
  /** Annotation/notes for this node */
  description?: string;
  /** Custom icon text override (e.g. "SB", "GA") — replaces type default icon */
  iconOverride?: string;
  /**
   * Opt-in label matchers for Grafana alert rules. When set, any firing/pending
   * alert whose labels contain ALL these key/value pairs will override the node's
   * metric-based status (firing → critical, pending → warning).
   * Omit or leave empty to disable alert integration for this node.
   */
  alertLabelMatchers?: Record<string, string>;
  /**
   * Opt-in list of external drill-down links shown as buttons at the top of the node popup.
   * URL templates support ${token} placeholders resolved against alertLabelMatchers + node built-ins (name, id).
   */
  observabilityLinks?: ObservabilityLink[];
  /**
   * Runtime-only flag marking a node as synthesized from a DynamicTargetQuery resolver.
   * Virtual nodes MUST NEVER be persisted back via onOptionsChange — they are derived
   * from the current target-query poll and exist only for this render cycle.
   */
  _virtual?: boolean;
}

/** External drill-down link from a node (logs, traces, runbooks, etc.) */
export interface ObservabilityLink {
  /** Display label on the button (e.g. "Logs", "Traces", "Runbook") */
  label: string;
  /** URL template — supports ${token} placeholders from node labels and built-ins (name, id) */
  url: string;
  /** Optional Grafana icon name (defaults to 'external-link-alt' when absent) */
  icon?: string;
}

// ============================================================
// GROUP TYPES
// ============================================================

export interface NodeGroup {
  /** Unique group id */
  id: string;
  /** Display label */
  label: string;
  /** Group type */
  type: 'ha_pair' | 'cluster' | 'pool' | 'custom';
  /** Node IDs in this group */
  nodeIds: string[];
  /** Visual style */
  style: 'dashed' | 'solid' | 'none';
}

// ============================================================
// EDGE / RELATIONSHIP TYPES
// ============================================================

export type EdgeType = 'traffic' | 'ha_sync' | 'failover' | 'monitor' | 'response' | 'custom';
export type EdgeStatus = 'healthy' | 'saturated' | 'degraded' | 'down' | 'nodata';
export type ThicknessMode = 'fixed' | 'proportional' | 'threshold';
export type FlowSpeed = 'auto' | 'slow' | 'normal' | 'fast' | 'none';
export type AnchorPoint = 'top' | 'bottom' | 'left' | 'right' | 'auto';

export interface EdgeMetricConfig {
  /** Datasource uid */
  datasourceUid: string;
  /** Query expression (PromQL for Prometheus; ignored for CloudWatch/Infinity which use queryConfig) */
  query: string;
  /** Alias for this metric */
  alias: string;
  /** Extra config for non-Prometheus datasources (CloudWatch dimensions, Infinity URL/rootSelector) */
  queryConfig?: DatasourceQueryConfig;
}

export interface TopologyEdge {
  /** Unique edge id */
  id: string;
  /** Source node id */
  sourceId: string;
  /** Target node id — for static edges */
  targetId?: string;
  /** Target query — for dynamic edges (e.g. pool members) */
  targetQuery?: DynamicTargetQuery;
  /** Edge type */
  type: EdgeType;
  /** Metric that drives edge value/color/thickness */
  metric?: EdgeMetricConfig;
  /** Label template: "${value} rps" */
  labelTemplate?: string;
  /** How thickness maps to metric value */
  thicknessMode: ThicknessMode;
  /** Min thickness in px */
  thicknessMin: number;
  /** Max thickness in px */
  thicknessMax: number;
  /** Threshold breakpoints for edge color */
  thresholds: ThresholdStep[];
  /** Animate flow dashes */
  flowAnimation: boolean;
  /** Flow speed mode — undefined means inherit from panel animation.defaultFlowSpeed */
  flowSpeed?: FlowSpeed;
  /** Bidirectional arrows */
  bidirectional: boolean;
  /** Source anchor point */
  anchorSource: AnchorPoint;
  /** Target anchor point */
  anchorTarget: AnchorPoint;
  /**
   * State mapping for categorical metrics (e.g. HA sync). Maps the stringified
   * metric value to a color. Valid color values: 'green' | 'yellow' | 'red'.
   * When set, overrides threshold-based coloring whenever the metric value
   * matches one of the keys.
   *
   * Example for a Prometheus metric that returns 1 (synced) or 0 (out of sync):
   *   { "1": "green", "0": "red" }
   */
  stateMap?: Record<string, string>;
  /** Annotation/notes for this edge */
  description?: string;
  /** Latency label (e.g. "p95: 12ms") displayed alongside metric label */
  latencyLabel?: string;
}

/** For edges where targets are discovered from a metric query */
export interface DynamicTargetQuery {
  /** Datasource uid */
  datasourceUid: string;
  /** Query that returns a list of targets (PromQL for Prometheus; ignored for CloudWatch/Infinity which use queryConfig) */
  query: string;
  /** Label from query results that maps to a node ID */
  nodeIdLabel: string;
  /** Extra config for non-Prometheus discovery (CloudWatch namespace/metricName/dimensions, Infinity URL/rootSelector) */
  queryConfig?: DatasourceQueryConfig;
  /** Template for auto-creating nodes from query results (not implemented in 3.1a/b — deferred) */
  nodeTemplate?: {
    type: NodeType;
    nameTemplate: string;
    compact: boolean;
  };
}

// ============================================================
// RUNTIME STATE (computed, not persisted)
// ============================================================

/** A firing or pending Grafana alert instance matched to a node */
export interface FiringAlert {
  ruleName: string;
  state: 'firing' | 'pending';
  labels: Record<string, string>;
  activeAt?: string;
  /** Merged rule-level + instance-level annotations (e.g. summary, description, runbook_url) */
  annotations?: Record<string, string>;
  /** Grafana rule UID for deep-linking to /alerting/grafana/{uid}/view (may be absent on older Grafana) */
  ruleUid?: string;
}

export interface NodeRuntimeState {
  nodeId: string;
  status: NodeStatus;
  metricValues: Record<string, MetricValue>;
  expanded: boolean;
  /** Alerts currently firing/pending against this node (empty/undefined = none) */
  firingAlerts?: FiringAlert[];
}

export interface EdgeRuntimeState {
  edgeId: string;
  status: EdgeStatus;
  value?: number;
  formattedLabel?: string;
  thickness: number;
  color: string;
  animationSpeed: number;
}

export interface MetricValue {
  raw: number | null;
  formatted: string;
  status: NodeStatus;
  sparklineData?: number[];
  /**
   * Unix ms timestamp when the raw value was last fetched. Populated only
   * for self-queried metrics (datasource values fetched via queryDatasource).
   * Panel-query-sourced metrics leave this undefined because Grafana's own
   * refresh UX is the source of truth for those.
   */
  fetchedAt?: number;
}

// ============================================================
// PANEL OPTIONS
// ============================================================

export interface TopologyPanelOptions {
  /** All node definitions */
  nodes: TopologyNode[];
  /** All edge/relationship definitions */
  edges: TopologyEdge[];
  /** Node groups (HA pairs, clusters, etc.) */
  groups: NodeGroup[];
  /** Canvas settings */
  canvas: {
    showGrid: boolean;
    gridSize: number;
    snapToGrid: boolean;
    backgroundColor: string;
  };
  /** Global animation settings */
  animation: {
    flowEnabled: boolean;
    defaultFlowSpeed: FlowSpeed;
    pulseOnCritical: boolean;
    /**
     * Freshness SLO for self-queried metrics in seconds. When a metric's
     * fetchedAt exceeds this threshold, the node popup marks the row as
     * stale. Default 60s (1 minute).
     */
    metricFreshnessSLOSec?: number;
    /**
     * Interval in milliseconds for polling the Grafana unified alerting
     * API to refresh firing alerts matched against nodes. Default 30000
     * (30s). Lower values increase API load; higher values delay how
     * quickly new alerts surface on the topology.
     */
    alertPollIntervalMs?: number;
  };
  /** Layout settings */
  layout: {
    autoLayout: boolean;
    direction: 'top-down' | 'left-right';
    tierSpacing: number;
    nodeSpacing: number;
  };
  /** Display settings */
  display: {
    showEdgeLabels: boolean;
    showNodeStatus: boolean;
    maxSummaryMetrics: number;
  };
}

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULT_NODE: Partial<TopologyNode> = {
  type: 'custom',
  role: '',
  metrics: [],
  position: { x: 100, y: 100 },
  compact: false,
};

export const DEFAULT_EDGE: Partial<TopologyEdge> = {
  type: 'traffic',
  thicknessMode: 'fixed',
  thicknessMin: 1.5,
  thicknessMax: 4,
  thresholds: [
    { value: 0, color: 'green' },
    { value: 70, color: 'yellow' },
    { value: 90, color: 'red' },
  ],
  flowAnimation: true,
  // flowSpeed omitted — undefined means "inherit from animation.defaultFlowSpeed"
  bidirectional: false,
  anchorSource: 'auto',
  anchorTarget: 'auto',
};

export const DEFAULT_PANEL_OPTIONS: TopologyPanelOptions = {
  nodes: [],
  edges: [],
  groups: [],
  canvas: {
    showGrid: true,
    gridSize: 20,
    snapToGrid: true,
    backgroundColor: 'transparent',
  },
  animation: {
    flowEnabled: true,
    defaultFlowSpeed: 'auto',
    pulseOnCritical: true,
    metricFreshnessSLOSec: 60,
    alertPollIntervalMs: 30000,
  },
  layout: {
    autoLayout: true,
    direction: 'top-down',
    tierSpacing: 120,
    nodeSpacing: 20,
  },
  display: {
    showEdgeLabels: true,
    showNodeStatus: true,
    maxSummaryMetrics: 4,
  },
};

// ============================================================
// NODE TYPE CONFIG (icon, default color per type)
// ============================================================

export const NODE_TYPE_CONFIG: Record<NodeType, { icon: string; color: string; defaultRole: string }> = {
  cloudflare: { icon: 'CF', color: '#ebcb8b', defaultRole: 'CDN / WAF' },
  firewall: { icon: 'FW', color: '#bf616a', defaultRole: 'Firewall' },
  loadbalancer: { icon: 'LB', color: '#d08770', defaultRole: 'Load Balancer' },
  virtualserver: { icon: 'VS', color: '#b48ead', defaultRole: 'Virtual Server' },
  pool: { icon: 'PL', color: '#a3be8c', defaultRole: 'Pool' },
  server: { icon: 'SRV', color: '#88c0d0', defaultRole: 'Server' },
  database: { icon: 'DB', color: '#5e81ac', defaultRole: 'Database' },
  cache: { icon: 'RD', color: '#bf616a', defaultRole: 'Cache' },
  queue: { icon: 'MQ', color: '#ebcb8b', defaultRole: 'Message Queue' },
  alb: { icon: 'ALB', color: '#d08770', defaultRole: 'Application LB' },
  nlb: { icon: 'NLB', color: '#d08770', defaultRole: 'Network LB' },
  nat: { icon: 'NAT', color: '#b48ead', defaultRole: 'NAT Gateway' },
  kubernetes: { icon: 'K8s', color: '#326ce5', defaultRole: 'Kubernetes' },
  accelerator: { icon: 'GA', color: '#ebcb8b', defaultRole: 'Global Accelerator' },
  logs: { icon: 'LOG', color: '#5e81ac', defaultRole: 'Log Aggregator' },
  probe: { icon: 'PRB', color: '#88c0d0', defaultRole: 'Synthetic Probe' },
  custom: { icon: '?', color: '#4c566a', defaultRole: '' },
};

/** Accent color for non-status visuals (sparklines, edge labels, info text) */
export const ACCENT_COLOR = '#5e81ac';

/** Secondary/muted text color — Nord palette nord3 */
export const MUTED_TEXT_COLOR = '#616e88';

export const STATUS_COLORS: Record<NodeStatus | EdgeStatus, string> = {
  ok: '#a3be8c',
  healthy: '#a3be8c',
  warning: '#ebcb8b',
  saturated: '#ebcb8b',
  critical: '#bf616a',
  degraded: '#bf616a',
  down: '#bf616a',
  unknown: '#4c566a',
  nodata: '#4c566a',
};
