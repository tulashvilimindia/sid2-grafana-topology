# E2E Topology Panel for Grafana

Interactive end-to-end topology diagram panel for Grafana. Visualize infrastructure flows with live metrics from any datasource, drag-and-drop node positioning, animated traffic connections with neon glow, and multi-metric popups with sparklines and freshness SLO tracking. Full canvas interactions: hover-to-focus edge dim, click-for-detail node and edge popups, right-click context menus, and Shift+drag to create new edges directly on the canvas.

Built by Mindia Tulashvili.

![Grafana 12+](https://img.shields.io/badge/Grafana-12.0%2B-orange)
![License](https://img.shields.io/badge/License-Apache%202.0-blue)
![Plugin Type](https://img.shields.io/badge/Type-Panel-green)
![Tests](https://img.shields.io/badge/tests-242%20passing-green)
![Bundle](https://img.shields.io/badge/bundle-162KB-blue)

---

## Features

### Topology Visualization
- **Draggable nodes** — freely position nodes on a grid canvas; positions persist with the dashboard JSON
- **Animated flow connections** — bezier curve edges with animated dashes showing traffic direction, enhanced with double drop-shadow neon glow that pulses in the edge's status color
- **HA pair & cluster grouping** — dashed/dotted containers visually bracket HA pairs, clusters, and server pools
- **Auto-layout** — topological sort positions nodes in tiers automatically (top-down or left-right) with O(V+E) complexity (no duplicate-enqueue bug on diamond fan-in)
- **Pan/zoom** — mouse wheel zoom, Ctrl+drag pan, "1:1" reset and "Fit" auto-fit-to-view buttons; viewport persists across panel remounts (edit↔view mode toggle)
- **Mobile responsive** — `@media (max-width: 768px)` bottom-sheet popup, wrapped toolbar, touch-action pan/pinch-zoom
- **Reduced motion** — respects `prefers-reduced-motion: reduce` and disables flow animations for users with vestibular disorders

### Canvas Interactions
- **Edge hover dim** — hovering any edge fades every other edge to 20 % opacity and pauses their flow animation, giving a focus-mode read on dense topologies. Transition is a 180 ms opacity fade (skipped under `prefers-reduced-motion`).
- **Edge click → metric popup** — clicking any edge opens an `EdgePopup` with the source → target header, current metric value coloured by status, mini SVG sparkline, and a threshold-band pill strip with the current band highlighted. Falls back to the runtime label when the range fetch returns no points (Infinity / CloudWatch snapshots).
- **Right-click context menu** — right-clicking a node or edge opens a floating menu with Duplicate, Copy node id (nodes only), and Delete. In edit mode an additional "Edit in sidebar" item routes through the `emitNodeEditRequest` / `emitEdgeEditRequest` event bus to scroll the matching card into view. Closes on outside click or Escape; clamps to panel bounds.
- **Shift+drag-to-connect** — in edit mode, Shift+pressing any node enters connect mode instead of drag mode; a dashed bezier rubber-band follows the cursor, and releasing over a target node appends a new edge via `onOptionsChange` and auto-opens the new edge's card in the sidebar editor. Escape cancels. Virtual (runtime-only) nodes are rejected.
- **Isolated hit-test overlay** — every edge has a transparent wide-stroke path in a dedicated SVG layer so hover / click / context-menu events are received on the stroke without touching the visual pipeline. The overlay's `pointerEvents` flips to `none` during node drag or a connect gesture so a fast cursor can never intercept mid-gesture events.

### Multi-Datasource Metric Integration
- **Prometheus** — instant queries via `/api/datasources/proxy/uid/{dsUid}/api/v1/query`
- **CloudWatch** — `namespace` + `metricName` + `dimensions` + `stat` + `period` via unified `/api/ds/query`
- **Infinity datasource** — `url` + `method` + `body` + `rootSelector` for any JSON-returning HTTP API. Supports GraphQL-style POST bodies for systems that expose metrics via arbitrary JSON endpoints.
- **Auto-fetch via `useSelfQueries`** — each metric polls its own datasource; debounced 500ms with AbortController cancellation and 10-second hard timeout per query
- **Panel-query compatibility** — metrics can also be sourced from the panel's own Grafana queries via `refId` match or `frame.name` fallback
- **Freshness SLO** — every self-queried metric carries a `fetchedAt` timestamp; a toolbar "N stale" pill surfaces metrics that exceed the configurable `metricFreshnessSLOSec` threshold

### Alert Integration
- **Grafana unified alerting** — `useAlertRules` hook polls the Grafana alerting API and matches alerts to nodes via `alertLabelMatchers` (key-value pairs the plugin looks for in alert labels)
- **Configurable poll interval** — `animation.alertPollIntervalMs` panel option, default 30s, clamped to 5s minimum so a user typo can't hammer the API
- **Runbook deep-links** — if a firing alert has a `runbook_url` annotation, the popup exposes it as a clickable link
- **Observability drill-downs** — per-node `observabilityLinks` with `${token}` interpolation (resolves from node fields and `alertLabelMatchers`)

### Dynamic Target Queries
Edges can define a `targetQuery` that resolves at runtime to N virtual edges, one per discovered target value. Supports all three datasource types (Prometheus label values, CloudWatch dimension enumeration, Infinity HTTP discovery). Virtual edges inherit parent metric values via the `parentId::targetValue` id convention. Poll interval: 60s.

### Node Click Popup
Clicking any node opens a popup positioned next to the clicked rect with:
- Up to 4 summary metrics with mini SVG sparklines and "Updated Ns ago" freshness labels that tick live every 15 seconds
- Firing alerts section with state badges, rule links, summary annotations, and optional runbook buttons
- Observability links with `${name}` / `${id}` / matcher-token URL templating
- Edit button (only in edit mode) that scrolls the matching sidebar card into view via a cross-subtree event bus

### Topology Patterns
The plugin supports three relationship patterns that cover all common topologies:

| Pattern | Example | Description |
|---------|---------|-------------|
| **1:1 direct** | CDN → WAF | Single source, single target, one metric drives edge |
| **1:N fan-out** | Pool → Members | One source fans out to multiple targets (optionally dynamic via `targetQuery`) |
| **HA pair bond** | PA1 ↔ PA2 | Bidirectional edge with optional `stateMap` for non-numeric states (e.g. `ha_sync`) |

### Panel Options

| Option | Default | Description |
|--------|---------|-------------|
| Show grid | On | Dot grid background for positioning reference |
| Snap to grid | On | Snap nodes to grid when dragging |
| Grid size | 20px | Grid spacing in pixels |
| Background color | transparent | Canvas background (any CSS color; "transparent" inherits dashboard theme) |
| Flow animation | On | Animate flow dashes on traffic edges (per-edge `flowAnimation` must also be true) |
| Default flow speed | auto | Panel-wide fallback flow speed (`auto`/`slow`/`normal`/`fast`/`none`) for edges that don't override |
| Pulse on critical | On | Pulse status dot when node is in critical state |
| **Alert poll interval (ms)** | 30000 | How often to refresh firing alerts (min 5000) |
| **Metric freshness SLO (s)** | 60 | Mark self-queried metric rows as Stale in the popup when fetchedAt age exceeds this |
| Auto layout | On | Run topological-sort auto-layout when node positions are at default. Off = honor stored positions exactly |
| Layout direction | Top-down | Auto-layout flow direction (`top-down` / `left-right`) |
| Tier spacing | 120px | Space between tiers in auto-layout |
| Node spacing | 20px | Space between nodes in the same tier |
| Show edge labels | On | Display metric values on edges |
| Show status dots | On | Show colored status indicator dots on nodes |
| Show metrics on cards | On | Show summary metric rows in collapsed node view |
| Show node icons | On | Show type-specific icons (CF, FW, LB, SRV, DB, etc.) |
| Max summary metrics | 4 | Number of metrics shown in collapsed node view |

---

## Installation

### Prerequisites

- **Grafana 12.0 or later** (SDK 12.0.10 targeted; earlier 10.x may work but isn't tested)
- **Node.js 18+** (for building from source; Node 24 LTS supported via `cross-env`)

### Build from Source

```bash
git clone https://github.com/tulashvilimindia/mtulashvili-sre-topology-panel.git
cd grafana-topology-plugin
npm install
npm run build
```

### Install on Grafana

1. Copy the `dist/` folder to your Grafana plugins directory:

```bash
# Linux
sudo cp -r dist/ /var/lib/grafana/plugins/mtulashvili-sre-topology-panel/

# macOS (Homebrew)
cp -r dist/ /opt/homebrew/var/lib/grafana/plugins/mtulashvili-sre-topology-panel/

# Windows
xcopy dist\ "C:\Program Files\GrafanaLabs\grafana\data\plugins\mtulashvili-sre-topology-panel\" /E /I
```

2. Allow the unsigned plugin in `grafana.ini`:

```ini
[plugins]
allow_loading_unsigned_plugins = mtulashvili-sre-topology-panel
```

Or via environment variable:

```bash
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=mtulashvili-sre-topology-panel
```

3. Restart Grafana:

```bash
sudo systemctl restart grafana-server
```

4. Verify: navigate to **Administration > Plugins**, search for "E2E Topology"

### Install via Docker

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/dist:/var/lib/grafana/plugins/mtulashvili-sre-topology-panel \
  -e GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=mtulashvili-sre-topology-panel \
  grafana/grafana-enterprise:12.0.0
```

### Install via Docker Compose

```yaml
services:
  grafana:
    image: grafana/grafana-enterprise:12.0.0
    ports:
      - "3000:3000"
    volumes:
      - ./dist:/var/lib/grafana/plugins/mtulashvili-sre-topology-panel
      - grafana-storage:/var/lib/grafana
    environment:
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: mtulashvili-sre-topology-panel
volumes:
  grafana-storage:
```

---

## Quick Start

### 1. Add the Panel

- Create or open a dashboard
- Click **Add > Visualization**
- Search for **"E2E Topology"** in the visualization type list
- Select it

### 2. Load Example Topology

The plugin ships with a built-in example topology. When the panel is empty:

- A **"Load example"** button appears in the panel toolbar (view mode) or the editor sidebar
- Click it to populate a complete tiered stack: **WAP Controller → Floor Gateway (HA) → SAS Poller (HA) → Meter Aggregator → Slot Bank → 6x Electronic Gaming Machines** (a land-based casino slot-floor network)
- A transient banner appears explaining that the example metrics are visual mocks — configure real datasources in the panel editor to see live values
- Dismiss the banner manually or let it auto-hide after 12 seconds

### 3. Interact

- **Drag** any node to reposition it (positions save with the dashboard)
- **Click** a node to open the node popup with live metrics, sparklines, firing alerts, and observability links
- **Click** any edge to open the edge popup with the current metric, sparkline, and threshold band breakdown
- **Hover** any edge to dim the rest of the topology to 20 % so you can trace a single flow in a dense graph
- **Right-click** any node or edge to open a context menu (Duplicate, Copy id, Delete; Edit in sidebar in edit mode)
- **Shift+drag** from one node to another (edit mode only) to create a new edge between them; the new edge's card auto-opens in the sidebar editor
- **Mouse wheel** to zoom in/out, **Ctrl+drag** (or middle-button drag) to pan, **"Fit"** button auto-frames all nodes, **"1:1"** resets zoom
- **"Auto layout"** button recalculates tier-based positions
- **"Expand all" / "Collapse all"** toggles all nodes

---

## Configuration

### Panel editor

Open any topology panel in edit mode. The custom editor sidebar on the right renders three collapsible sections: **Nodes**, **Relationships** (edges), and **Groups**. Everything you see in the JSON schema further down is edited here via forms, dropdowns, and colour pickers — you rarely need to touch the JSON directly.

#### Nodes editor

- **Add** — click the `+` button to create a new node card. It defaults to `type: server` at position (100, 100) and auto-lays-out on next render
- **Bulk Import** — when a Prometheus datasource is selected, the editor can fetch the list of instances via `/api/v1/series`, let you pick hosts and which metrics to include, and create one node per host in a single click
- **Search filter** — appears automatically when the list has more than 3 nodes; filters by name, role, or type
- **Import topology JSON** — upload a full exported payload; merges nodes slice, routes any edges/groups/canvas/animation/layout/display sub-objects through a cross-subtree event bus so the panel owns the actual `onOptionsChange` call
- **Export topology JSON** — downloads the entire options object (v2 format) as a file
- **Per-node card** — name, role, type dropdown, compact toggle, width, position, alert label matchers (key=value list), observability links with `${token}` URL interpolation, metrics list
- **Metric sub-editor** — datasource picker (any Grafana datasource works), query field, format template, section, isSummary toggle, showSparkline toggle, threshold colour editor, plus **collapsible CloudWatch section** (namespace / metricName / dimensions key-value list / stat / period) and **collapsible Infinity section** (url / method / rootSelector / optional JSON body) that appear automatically based on the picked datasource's type
- **Delete confirmation** — asks before deleting, tells you how many edges will be orphaned, auto-removes those orphans via the `panelEvents` bus

#### Relationships (edges) editor

- **Add / delete / duplicate** — same card-based pattern as nodes; new edges can also be created directly on the canvas by **Shift+drag** between two nodes (see [Canvas Interactions](#canvas-interactions)), which appends the edge and auto-scrolls its card into view
- **Auto-surface on edit request** — right-clicking an edge on the canvas and choosing "Edit in sidebar" (or clicking the Edit button inside the edge popup) scrolls the matching card into view and expands it via the `emitEdgeEditRequest` cross-subtree channel
- **Search filter** — by source/target name, source/target id, or edge type
- **Source/target pickers** — dropdowns populated from the nodes list
- **Type dropdown** — `traffic`, `ha_sync`, `failover`, `monitor`, `response`, `custom`
- **Thickness** — mode (`fixed`/`proportional`/`threshold`), min/max pixel values, and per-edge thresholds
- **Flow animation** — toggle + speed dropdown (`auto`/`slow`/`normal`/`fast`/`none`)
- **State map editor** — key-value pairs for mapping non-numeric metric values (e.g. `"synced" → green`, `"out_of_sync" → red`) for things like HA sync status
- **Dynamic targets** — enables `targetQuery` editor with the same datasource/query/nodeIdLabel fields for runtime edge expansion
- **Metric sub-editor** — same datasource picker / CloudWatch / Infinity sections as the node metric editor

#### Groups editor

- **Add / delete** — create HA pairs, clusters, or custom groupings
- **Search filter** — by label, type, or any member node name
- **Member picker** — multi-select dropdown from the nodes list
- **Style dropdown** — `dashed`, `solid`, or `none`

#### Panel options (top-level)

All the toggles in the **Panel Options** table at the top of this README are rendered as standard Grafana panel-option controls in the right sidebar (not in the custom editor): background colour picker, flow-animation toggles, poll interval number inputs, layout direction dropdown, etc.

### Topology Data Model

> **You do not need to write JSON by hand.** The plugin ships a full visual editor in the Grafana panel-editor sidebar (see the [Panel editor](#panel-editor) section below) with drag-and-drop cards for nodes, edges, and groups, a datasource picker per metric, a threshold colour editor, CloudWatch/Infinity query wizards, bulk import of nodes from Prometheus metric discovery, search filters, import/export of the full dashboard payload, and live data previews.
>
> The schema below is the reference for what the editor writes into `panel.options` — useful if you're **inspecting a saved dashboard**, **exporting for version control**, **migrating from another tool**, or **generating dashboards programmatically** via the Grafana HTTP API. Most users can skip to the [Panel editor](#panel-editor) section.

Each topology consists of three arrays: **`nodes`**, **`edges`**, and **`groups`**, plus per-panel sub-objects for `canvas`, `animation`, `layout`, and `display` options.

#### Nodes

```json
{
  "id": "n-cf",
  "name": "Cloudflare Edge",
  "role": "CDN / WAF",
  "type": "cloudflare",
  "position": { "x": 245, "y": 20 },
  "compact": false,
  "width": 180,
  "groupId": "grp-ha-pair",
  "metrics": [
    {
      "id": "cf-rps",
      "label": "rps",
      "datasourceUid": "your-datasource-uid",
      "query": "sum(rate(http_requests_total[5m]))",
      "format": "${value} rps",
      "section": "Traffic",
      "isSummary": true,
      "thresholds": [
        { "value": 0, "color": "green" },
        { "value": 15000, "color": "yellow" },
        { "value": 25000, "color": "red" }
      ],
      "showSparkline": true
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique node identifier |
| `name` | string | Display name |
| `role` | string | Short role/description shown below name |
| `type` | enum | Node type: `cloudflare`, `firewall`, `loadbalancer`, `virtualserver`, `pool`, `server`, `database`, `cache`, `queue`, `alb`, `nlb`, `nat`, `kubernetes`, `accelerator`, `logs`, `probe`, `custom` |
| `position` | {x, y} | Canvas position (auto-calculated if {100, 100}) |
| `compact` | boolean | Compact mini-node style (for server pools) |
| `width` | number | Fixed width in pixels (optional) |
| `groupId` | string | Group this node belongs to (optional) |
| `metrics` | array | Metric configurations (see below) |

#### Node Metrics

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Internal unique metric id; used as stable React key and fallback refId match |
| `refId` | string | Optional explicit Grafana panel-query `refId` — when set, takes precedence over `id` for matching panel data frames |
| `label` | string | Display label (e.g. "cpu", "rps") |
| `datasourceUid` | string | Grafana datasource UID |
| `query` | string | Query expression (PromQL for Prometheus, ignored for CloudWatch/Infinity which use `queryConfig`) |
| `queryConfig` | object | Optional datasource-specific config: `namespace`/`metricName`/`dimensions`/`stat`/`period` (CloudWatch), or `url`/`method`/`body`/`rootSelector` (Infinity) |
| `format` | string | Value format template: `"${value}%"`, `"${value} rps"`, `"${value} B/s"` — `${value}` is replaced with the formatted number |
| `section` | string | Section name for grouping metrics in the expanded / popup view |
| `isSummary` | boolean | `true` = visible in collapsed view and in the popup (max 4), `false` = shown only in the in-card expanded section |
| `thresholds` | array | Color breakpoints: `[{value: 0, color: "green"}, {value: 80, color: "red"}]`. Evaluated descending — first match wins |
| `showSparkline` | boolean | Show mini SVG sparkline chart in the popup |

#### Edges

```json
{
  "id": "e-cf-pa1",
  "sourceId": "n-cf",
  "targetId": "n-pa1",
  "type": "traffic",
  "thicknessMode": "proportional",
  "thicknessMin": 1.5,
  "thicknessMax": 4,
  "thresholds": [
    { "value": 0, "color": "green" },
    { "value": 70, "color": "yellow" },
    { "value": 90, "color": "red" }
  ],
  "flowAnimation": true,
  "flowSpeed": "auto",
  "bidirectional": false,
  "anchorSource": "auto",
  "anchorTarget": "auto",
  "labelTemplate": "${value} rps",
  "metric": {
    "datasourceUid": "your-datasource-uid",
    "query": "sum(rate(http_requests_total[5m]))",
    "alias": "cf-to-pa-traffic"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique edge identifier |
| `sourceId` | string | Source node ID |
| `targetId` | string | Target node ID |
| `type` | enum | `traffic`, `ha_sync`, `failover`, `monitor`, `response`, `custom` |
| `thicknessMode` | enum | `fixed`, `proportional` (scales with value), `threshold` (step function) |
| `thicknessMin/Max` | number | Thickness range in pixels |
| `thresholds` | array | Color breakpoints (same format as node metrics) |
| `flowAnimation` | boolean | Enable animated flow dashes |
| `flowSpeed` | enum | `auto` (scales with metric), `slow`, `normal`, `fast`, `none` |
| `bidirectional` | boolean | Render arrows in both directions |
| `anchorSource/Target` | enum | `auto`, `top`, `bottom`, `left`, `right` |
| `labelTemplate` | string | Label with `${value}` interpolation |
| `metric` | object | Optional datasource query for this edge |

#### Groups

```json
{
  "id": "grp-pa",
  "label": "HA -- Firewall",
  "type": "ha_pair",
  "nodeIds": ["n-pa1", "n-pa2"],
  "style": "dashed"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique group identifier |
| `label` | string | Display label (shown above group border) |
| `type` | enum | `ha_pair`, `cluster`, `pool`, `custom` |
| `nodeIds` | string[] | IDs of nodes in this group |
| `style` | enum | `dashed`, `solid`, `none` |

### Connecting to Data Sources

Each metric references a Grafana datasource by its UID. The plugin matches query results to metrics by:

1. `frame.refId === metric.id` -- primary match
2. `frame.name === metric.label` -- fallback match

To find datasource UIDs:
```bash
curl -s http://your-grafana/api/datasources | jq '.[].uid'
```

### Node Types and Icons

| Type | Icon | Default Color | Typical Use |
|------|------|---------------|-------------|
| `cloudflare` | CF | Gold | CDN / WAF edge |
| `firewall` | FW | Red | Firewall |
| `loadbalancer` | LB | Orange | Generic load balancer |
| `alb` | ALB | Orange | AWS Application Load Balancer |
| `nlb` | NLB | Orange | AWS Network Load Balancer |
| `accelerator` | GA | Gold | AWS Global Accelerator |
| `nat` | NAT | Purple | NAT gateway |
| `virtualserver` | VS | Purple | Virtual server / VIP |
| `pool` | PL | Green | Server pool |
| `server` | SRV | Cyan | Application server |
| `kubernetes` | K8s | Blue | Kubernetes cluster or workload |
| `database` | DB | Blue | Database |
| `cache` | RD | Red | Cache (Redis, etc.) |
| `queue` | MQ | Gold | Message queue |
| `logs` | LOG | Blue | Log aggregator (Loki, CloudWatch Logs, etc.) |
| `probe` | PRB | Cyan | Synthetic probe / uptime monitor |
| `custom` | ? | Gray | Custom node type |

### Edge Visual Behavior

| Property | Drives | Details |
|----------|--------|---------|
| `type` | Line style | traffic=solid, ha_sync=dashed, failover=dotted, monitor=fine dots |
| `thresholds + metric` | Color | green/yellow/red based on value vs threshold breakpoints |
| `thicknessMode + metric` | Stroke width | fixed=constant, proportional=linear scale, threshold=step function |
| `flowAnimation + flowSpeed` | Dash animation | auto=faster with higher traffic, or fixed slow/normal/fast |
| `bidirectional` | Arrow direction | false=one-way arrow, true=arrows both directions |

---

## Development

### Local Development Setup

```bash
# Install dependencies
npm install

# Start webpack in watch mode (terminal 1)
npm run dev

# Start local Grafana with plugin mounted (terminal 2)
docker compose up
```

Access Grafana at **http://localhost:13100** (anonymous access enabled, Admin role).

### Project Structure

```
src/
  module.ts                         -- Plugin entry; registers PanelPlugin and setPanelOptions builder
  plugin.json                       -- Plugin manifest (id, version, dependencies, URL allowlist)
  types.ts                          -- All interfaces, defaults, enums, and color constants
  components/
    TopologyPanel.tsx               -- Main panel: toolbar, state orchestration, popup positioning, context-menu dispatch, edge-create handler
    TopologyPanel.css               -- All styles: Nord theme, animations, mobile media queries
    TopologyCanvas.tsx              -- SVG edge renderer + hit-test overlay, pan/zoom, drag, hover dim, drag-to-connect
    NodePopup.tsx                   -- Node click popup with sparklines + alerts + observability links
    EdgePopup.tsx                   -- Edge click popup: current metric value, sparkline, threshold band pills
    ContextMenu.tsx                 -- Right-click context menu for nodes and edges (Duplicate / Copy id / Delete / Edit in sidebar)
  editors/
    NodesEditor.tsx                 -- Nodes slice editor: search, bulk import, delete confirm, export/import
    EdgesEditor.tsx                 -- Edges slice editor with search filter
    GroupsEditor.tsx                -- Groups slice editor with search filter
    exampleTopology.ts              -- Built-in example topology loader
    editors.css                     -- Editor sidebar styles
    components/
      NodeCard.tsx                  -- Per-node editor card
      EdgeCard.tsx                  -- Per-edge editor card
      GroupCard.tsx                 -- Per-group editor card
      MetricEditor.tsx              -- Metric query + thresholds + datasource-specific config
      ThresholdList.tsx             -- Threshold row editor
    utils/
      editorUtils.ts                -- Pure editor helpers (id generation, validation)
  hooks/
    useSelfQueries.ts               -- Debounced multi-datasource metric fetch with AbortController
    useAlertRules.ts                -- Grafana unified alerting API polling
    useDynamicTargets.ts            -- Dynamic target query resolution (60s poll)
  utils/
    datasourceQuery.ts              -- Unified query abstraction (Prometheus/CloudWatch/Infinity)
    alertRules.ts                   -- Alert rule fetch + label matcher logic
    dynamicTargets.ts               -- Dynamic target resolvers for all 3 datasource types
    edges.ts                        -- Pure edge math: bezier paths, anchors, status, thickness, speed
    layout.ts                       -- Topological sort + tier assignment + positioning
    viewport.ts                     -- Pan/zoom math, fit-to-view calculation
    viewportStore.ts                -- Per-panel viewport persistence across remounts
    panelEvents.ts                  -- Cross-subtree pub/sub (panel <-> editor sidebar)
    __tests__/                      -- Jest unit tests for all utilities and hooks
  components/__tests__/             -- Component integration tests (NodePopup, EdgePopup, ContextMenu, TopologyPanel)
  img/
    logo.svg                        -- Plugin icon
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Webpack watch mode (rebuilds on save) |
| `npm run build` | Production build to `dist/` |
| `npm run test` | Run Jest tests (watches in dev) |
| `npm run test:ci` | Run Jest in CI mode (parallel, non-watch) — used in the 4-gate validation |
| `npm run lint` | ESLint check |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run server` | Start Docker Compose Grafana (`docker compose up --build`) |
| `npm run sign` | Sign the plugin via `@grafana/sign-plugin` (requires `GRAFANA_ACCESS_POLICY_TOKEN` and `GRAFANA_ROOT_URLS` env vars) |

### Technology Stack

Every dependency listed with its exact resolved version, what it does in this project, and where it is used.

#### Runtime Dependencies

| Library | Version | Purpose | Used In |
|---------|---------|---------|---------|
| **React** | 18.3.1 | UI component framework. All topology nodes, toolbar, and canvas are React functional components using hooks (`useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`). React is provided as an external by Grafana at runtime -- not bundled. | `TopologyPanel.tsx`, `TopologyCanvas.tsx`, `TopologyEditor.tsx` |
| **React DOM** | 18.3.1 | React renderer for browser DOM. Provided as external by Grafana. | Implicit via React |
| **@grafana/data** | 12.0.10 | Grafana Plugin SDK — core data types. Provides `PanelPlugin` class for plugin registration, `PanelProps` interface for panel component props, `DataFrames` for query result structure, `FieldType` for data matching, and `StandardEditorProps` for custom editors. | `module.ts` (PanelPlugin + setPanelOptions), `TopologyPanel.tsx` (PanelProps, data.series), all editor components |
| **@grafana/runtime** | 12.0.10 | Grafana Plugin SDK — runtime services. Provides `getDataSourceSrv()` for datasource instance lookup (used by `detectDatasourceType`) and `replaceVariables()` for template variable interpolation. | `datasourceQuery.ts`, `useSelfQueries.ts` |
| **@grafana/ui** | 12.0.10 | Grafana Plugin SDK — React component library. Provides themed components (`Button`, `IconButton`, `Input`, `Select`, `TextArea`, `CollapsableSection`, `Checkbox`, `DataSourcePicker`) used throughout editor components. | `NodeCard.tsx`, `EdgeCard.tsx`, `GroupCard.tsx`, `MetricEditor.tsx`, `ThresholdList.tsx`, `NodePopup.tsx` (Icon) |
| **Lodash** | 4.17.21 | Utility library. Loaded as external by Grafana. Currently unused in plugin source but available for future use. | Declared external in webpack |

#### Grafana Plugin SDK (Build & Configuration)

| Library | Version | Purpose | Used In |
|---------|---------|---------|---------|
| **@grafana/tsconfig** | 2.0.1 | Shared TypeScript compiler configuration for Grafana plugins. Extended by `.config/tsconfig.json`. Sets strict mode, ES2021 target, ESNext modules, and all standard Grafana TS conventions. | `tsconfig.json` (extends `.config/tsconfig.json`) |
| **@grafana/eslint-config** | 7.0.0 | Shared ESLint ruleset for Grafana plugins. Configures React, TypeScript, import ordering, and Grafana-specific rules. Extended by `.config/_eslintrc`. | `.eslintrc` (extends `.config/_eslintrc`) |
| **@grafana/plugin-e2e** | 3.4.12 | Grafana's Playwright-based E2E testing framework for plugins. Available for writing end-to-end tests against a running Grafana instance. | Reserved for future E2E suite |

#### Build System -- Webpack 5 + SWC

| Library | Version | Purpose | Used In |
|---------|---------|---------|---------|
| **Webpack** | 5.106.1 | Module bundler. Compiles TypeScript + CSS + assets into a single AMD module (`dist/module.js`) that Grafana loads at runtime. Configured for production minification and development watch mode with live reload. | `.config/webpack/webpack.config.ts` |
| **webpack-cli** | 5.1.4 | Command-line interface for Webpack. Invoked via `npm run build` and `npm run dev`. Handles config file loading (TypeScript configs via ts-node). | `package.json` scripts |
| **@swc/core** | 1.15.24 | Rust-based JavaScript/TypeScript compiler. Replaces Babel for 10-20x faster transpilation. Compiles TSX to ES2015 JavaScript with React JSX transform. | `.config/webpack/webpack.config.ts` (swc-loader options) |
| **swc-loader** | 0.2.7 | Webpack loader that pipes `.ts`/`.tsx` files through SWC. Configured with TypeScript parser, TSX support, and ES2015 target. | `.config/webpack/webpack.config.ts` (module.rules) |
| **@swc/helpers** | 0.5.21 | Runtime helpers for SWC-compiled code (async/await transforms, class properties, etc.). Avoids inlining helper code in every file. | Implicitly used by SWC output |
| **css-loader** | 6.11.0 | Webpack loader that resolves `@import` and `url()` in CSS files, converting them to JavaScript modules. | `.config/webpack/webpack.config.ts` (CSS rule) |
| **style-loader** | 3.3.4 | Webpack loader that injects CSS into the DOM via `<style>` tags at runtime. Paired with css-loader. | `.config/webpack/webpack.config.ts` (CSS rule) |
| **sass** | 1.99.0 | Dart Sass compiler. Compiles SCSS/Sass to CSS. Available for SCSS support though the plugin currently uses plain CSS. | `.config/webpack/webpack.config.ts` (SCSS rule) |
| **sass-loader** | 13.3.3 | Webpack loader that pipes `.scss`/`.sass` files through Dart Sass. Configured as the first loader in the SCSS rule chain. | `.config/webpack/webpack.config.ts` (SCSS rule) |
| **copy-webpack-plugin** | 11.0.0 | Copies static files (`plugin.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `img/`) from source to `dist/` during build. Uses `path.resolve(process.cwd(), ...)` for reliable cross-platform paths. | `.config/webpack/webpack.config.ts` (plugins) |
| **replace-in-file-webpack-plugin** | 1.0.6 | Post-build string replacement in `dist/plugin.json`. Replaces `%VERSION%` with package version and `%TODAY%` with build date. | `.config/webpack/webpack.config.ts` (plugins) |
| **fork-ts-checker-webpack-plugin** | 9.1.0 | Runs TypeScript type checking in a separate process (forked), so it doesn't block webpack compilation. Only active in development mode. | `.config/webpack/webpack.config.ts` (dev plugins) |
| **eslint-webpack-plugin** | 4.2.0 | Runs ESLint during webpack builds. Configured for `.ts`/`.tsx` files with `lintDirtyModulesOnly` (only lints changed files) in development mode. | `.config/webpack/webpack.config.ts` (dev plugins) |
| **webpack-livereload-plugin** | 3.0.2 | Injects a livereload script into the bundle that triggers browser reload when `dist/` changes. Active only in development mode. | `.config/webpack/webpack.config.ts` (dev plugins) |
| **webpack-virtual-modules** | 0.6.2 | Creates virtual (in-memory) webpack modules. Reserved for dynamic module generation (e.g., public path injection). | Available in webpack config |
| **ts-node** | 10.9.2 | TypeScript execution engine. Used by webpack-cli to load `.config/webpack/webpack.config.ts` directly without pre-compilation. Requires `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'` on Node.js 24+ due to ESM defaults. | webpack-cli config loading |
| **tsconfig-paths** | 4.2.0 | Resolves TypeScript path aliases (`@/*`) at runtime via ts-node. Enables path mapping from `tsconfig.json` during webpack config loading. | ts-node integration |
| **TypeScript** | 5.9.3 | Static type checker. All source files are TypeScript (`.ts`/`.tsx`). The compiler is used for type checking only (`noEmit: true`) -- actual compilation is handled by SWC. | `tsconfig.json`, `npm run typecheck` |

#### Testing

| Library | Version | Purpose | Used In |
|---------|---------|---------|---------|
| **Jest** | 29.7.0 | Test runner framework. Configured with jsdom environment for React component testing. Uses SWC for fast test transpilation. | `jest.config.js` (extends `.config/jest.config.js`) |
| **jest-environment-jsdom** | 29.7.0 | Jest environment that provides a browser-like DOM (via jsdom) for testing React components without a real browser. | `.config/jest.config.js` (testEnvironment) |
| **@swc/jest** | 0.2.39 | Jest transformer that uses SWC instead of Babel for TypeScript/JSX compilation during test runs. 5-10x faster than ts-jest. | `.config/jest.config.js` (transform) |
| **@testing-library/react** | 14.3.1 | React testing utilities. Provides `render()`, `screen`, and `fireEvent` for testing React components from the user's perspective. | Test files (`*.test.tsx`) |
| **@testing-library/jest-dom** | 6.9.1 | Custom Jest matchers for DOM assertions (`toBeInTheDocument()`, `toHaveClass()`, `toBeVisible()`). Loaded in jest-setup.js. | `jest-setup.js` → `.config/jest-setup.js` |
| **identity-obj-proxy** | 3.0.0 | Jest module mock that returns the property name as a string. Used to mock CSS module imports (`*.css` → `{ className: 'className' }`). | `.config/jest.config.js` (moduleNameMapper for CSS) |

#### Code Quality

| Library | Version | Purpose | Used In |
|---------|---------|---------|---------|
| **ESLint** | 8.57.1 | JavaScript/TypeScript linter. Enforces Grafana coding standards via `@grafana/eslint-config`. Runs during development builds (via eslint-webpack-plugin) and via `npm run lint`. | `.eslintrc`, `npm run lint` |
| **Prettier** | 3.8.2 | Code formatter. Configured for 120 char lines, trailing commas, single quotes, 2-space indent, auto line endings (CRLF/LF). | `.prettierrc.js` |
| **glob** | 10.5.0 | File pattern matching. Used internally by build tools for file discovery. | Build tooling internals |

#### Type Definitions

| Library | Version | Purpose |
|---------|---------|---------|
| **@types/react** | 18.3.28 | TypeScript definitions for React API |
| **@types/react-dom** | 18.3.7 | TypeScript definitions for React DOM API |
| **@types/jest** | 29.5.14 | TypeScript definitions for Jest API |
| **@types/lodash** | 4.17.24 | TypeScript definitions for Lodash utilities |
| **@types/node** | 20.19.39 | TypeScript definitions for Node.js built-ins (used in webpack config) |

#### Development Infrastructure

| Tool | Version | Purpose |
|------|---------|---------|
| **Docker** | (host) | Runs local Grafana 12.0.0 via `docker-compose.yaml` for plugin development and testing |
| **Grafana Enterprise** | 12.0.0 | Target panel host. Docker image `grafana/grafana-enterprise:12.0.0` with anonymous auth (Admin role), unsigned plugin allowlist, debug logging. Dev port 13100 per `docker-compose.yaml`. |
| **supervisord** | Alpine pkg | Process manager inside Docker container. Runs Grafana's `/run.sh` with stdout logging |
| **Node.js** | >= 18 (Node 24 LTS tested) | JavaScript runtime for build tools. The `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'` env var required by Node 24+ is wired through `cross-env` in every npm script, so Windows CMD / macOS / Linux all work identically. |
| **cross-env** | 10.1.0 (devDep) | The one explicit exception to the "no new deps" rule — a 5 KB build-time-only wrapper that sets env vars portably. Used by `npm run build`, `npm run dev`, and `npm run server`. |
| **npm** | 11.9.0 | Package manager |

### Technical Approach

| Concern | Approach | Rationale |
|---------|----------|-----------|
| **Rendering** | SVG layer for edges (bezier `<path>` elements) + absolutely-positioned HTML `<div>` node cards | Avoids canvas/WebGL complexity. HTML nodes get native CSS animations, text rendering, and accessibility. SVG gives smooth scalable curves. |
| **Drag-and-drop** | `pointerdown` → document-level `pointermove`/`pointerup` listeners via `useEffect` | Pointer events work across mouse/touch. Document-level listeners prevent drag from breaking when cursor moves off the node element. |
| **Click vs drag** | `useRef<boolean>` for `hasMoved` flag, checked synchronously in `onClick` | Avoids React state batching delay that causes stale closure reads. Ref is updated synchronously in pointermove and read synchronously in click. |
| **Position persistence** | Debounced `onOptionsChange()` (300ms) writes positions back to Grafana panel JSON | Positions survive page reload. Debounce prevents hammering Grafana's state system on every mousemove during drag. |
| **Edge geometry** | Cubic bezier curves with auto-calculated anchor points based on relative node positions | `getAnchorPoint()` chooses top/bottom/left/right based on source-to-target angle. `getBezierPath()` generates smooth S-curves. |
| **Layout algorithm** | BFS topological sort → tier assignment → centered X positioning per tier | Handles DAGs. Skips bidirectional edges (HA sync) to prevent cycles. Per-tier width calculation sums actual node widths for correct alignment. |
| **Flow animation** | `@keyframes topoFlow` with `stroke-dashoffset` + double `drop-shadow` SVG filter | Dashes slide along the bezier path via CSS animation, and the overlay path carries a double drop-shadow filter (3px inner + 6px outer halo) keyed to the edge's status colour so critical edges glow red and healthy edges glow soft green. No JS animation loop. |
| **Edge rendering perf** | `React.memo`-wrapped `EdgeRender` sub-component with primitive-only props (`fromX`/`fromY`/`toX`/`toY`, `edgeColor`, `thickness`, `flowSpeed`, etc.) | Default shallow comparison skips re-render when `edgeStates` rebuilds but this edge's computed values didn't change. Parent loop still computes rects + paths; child is dumb. |
| **Edge data pipeline** | `useMemo` computes `Map<string, EdgeRuntimeState>` from DataFrames | Matches frame.refId or frame.name to edge metric alias. Computes color/thickness/speed/label per edge. |
| **Parallel edges** | Perpendicular unit-normal offset derived from `(toRaw − fromRaw)` vector | Multiple edges between the same node pair spread symmetrically in the correct direction regardless of edge orientation (vertical, diagonal, or horizontal). |
| **Edge hit-test overlay** | Dedicated second SVG layer inside the pan/zoom wrapper with one transparent wide-stroke `<path>` per edge (`strokeWidth = thickness + 12`, `pointerEvents: 'stroke'`, `data-testid="edge-hit-${id}"`) | The visual edge layer keeps `pointerEvents: 'none'` so it never fights the node-drag state machine; all edge interactions (hover / click / right-click / drag-to-connect hit test) route through this invisible overlay. Geometry is computed once per render into a shared `edgeGeometry` map so the two layers cannot diverge. |
| **Edge hover dim** | `hoveredEdgeId` state in `TopologyCanvas`; `EdgeRender` receives `isDimmed` as a primitive boolean prop (not a derived object) | Primitive props let `React.memo`'s shallow compare bound re-renders to exactly the two affected edges per hover toggle (previous hovered + new hovered). A 180 ms opacity transition animates the fade; `prefersReducedMotionRef` reads `matchMedia('(prefers-reduced-motion: reduce)')` once on mount and skips the transition. |
| **Drag-to-connect** | Two-state split: `connectingSourceId` (stable for the whole gesture) and `connectingCursor` (ticks per `pointermove`). The document-listener `useEffect` depends only on `connectingSourceId` so it registers once on start and tears down once on end — not once per cursor tick. | A naive single-state shape would re-register document listeners every frame, producing measurable frame hitches under a fast drag. The rubber-band bezier lives inside the visual SVG layer so it inherits `pointerEvents: 'none'` and cannot intercept its own gesture. Virtual (runtime-only, `_virtual: true`) nodes are rejected as drag sources because they have no persisted slice entry. `hasMovedRef.current = true` is set on gesture start so the bubbled click event from pointerup cannot open a spurious node popup on the release target. |
| **Context menu positioning** | `ContextMenu` is rendered by `TopologyPanel` inside its panel-relative wrapper, position clamped against `panelRect` | Mirrors the `NodePopup` / `EdgePopup` clamping path so menus, popups, and the hit-test layer all share one coordinate system. `document`-level `mousedown` + `keydown` listeners close on outside click or Escape and unregister in the cleanup. |
| **SVG overflow** | `overflow: visible` on the topology edge SVG root | SVG root elements default to `overflow: hidden` (unlike `<div>`). Without this override, bezier paths that extend past the SVG's layout box — common after Auto Layout + Fit places nodes at coordinates beyond the initial viewport — get clipped before the pan/zoom wrapper's CSS transform is applied. |
| **Group z-order** | Groups at `zIndex: 0`, SVG edges at `zIndex: 1`, nodes at `zIndex: 2` | Group containers sit below the edge layer so edges that cross a group's bounding rectangle remain visible. Nodes still sit on top of everything. |
| **Multi-panel safety** | `useRef<Map<string, HTMLDivElement>>` with ref callbacks instead of `document.getElementById` | Scoped to component instance. No global DOM ID collisions when multiple topology panels exist on one dashboard. |
| **Viewport persistence** | Module-level `Map<panelId, ViewportState>` in `viewportStore.ts` | React state inside the canvas component is lost when Grafana remounts the panel (edit↔view toggle). Module state survives remount because the webpack singleton outlives any component lifecycle. |
| **Metric thresholds** | Descending sort → first match wins | `[{value: 0, color: green}, {value: 70, color: yellow}, {value: 90, color: red}]` — value 85 matches yellow (85 ≥ 70, checked before 0). |
| **Null vs NaN handling** | `null`/`undefined` in query response → `{value: null}` with no error flag; actual parse failure also treated as empty | Aggregations over zero rows (`percentage()`, `percentile()`, `average()` in NRQL; division-by-zero NaN in PromQL) are legitimate "no data in window" signals, not parse errors. Flagging them would pollute the toolbar stale-metrics counter for sparse services. |
| **Fetch cancellation** | `AbortController` + 10s hard timeout on every query, signal threaded through `useSelfQueries` | Unmounting a panel or switching dashboards cancels in-flight fetches immediately. A hung datasource is bounded to 10 seconds instead of ~2 minutes of TCP default. |
| **Toolbar responsiveness** | `ResizeObserver` on the toolbar element + state-driven canvas height | The toolbar wraps to multiple rows on narrow viewports; hardcoding 36px clipped the canvas on mobile. The observer feeds the live height into the canvas `height` calculation. |
| **Cross-subtree events** | Module-level pub/sub in `panelEvents.ts` — `emitNodeClicked`, `emitNodeEditRequest`, `emitEdgeEditRequest`, `emitOrphanEdgeCleanup`, `emitTopologyImport` | `NodesEditor` / `EdgesEditor` render inside Grafana's panel-editor subtree, which is a completely different React tree from `TopologyPanel`. React Context cannot cross that boundary. A tiny module-level pub/sub does. The edge channel is how the right-click "Edit in sidebar" item, the edge popup's Edit button, and the freshly-created edge from drag-to-connect all scroll + expand the matching card in `EdgesEditor`. |
| **Theme** | Nord-inspired palette in a single CSS file | `#13161a` background, `#1a1e24` cards, `#2d3748` borders, status colours from `STATUS_COLORS` constant. No CSS modules — all styles scoped by class prefix. Respects `prefers-reduced-motion: reduce`. |

### Architecture Decisions

- **No external diagramming libraries** -- custom SVG edge renderer + HTML node cards (no dagre, d3-force, or elkjs). Sufficient for <50 nodes.
- **Drag-and-drop** via pointer events, positions persisted in panel JSON via `onOptionsChange`
- **Auto-layout** via topological sort + tier-based positioning with cycle detection (handles bidirectional HA edges)
- **Dark theme only** — Nord-inspired palette (light theme is on the roadmap)
- **Single CSS file** -- no CSS modules, no styled-components
- **Scoped DOM refs** -- component-scoped `useRef<Map>` instead of `document.getElementById` (safe for multi-panel dashboards)
- **SWC over Babel** -- Rust-based compiler for 10-20x faster builds
- **AMD module output** -- Grafana's plugin loader uses AMD (`require`/`define`), all `@grafana/*`, `react`, `lodash` are externals provided by the host

---

## Example: Slot Floor SAS Network

The built-in example topology visualises a land-based casino slot-machine
network. Vocabulary is drawn from IGT/Bally Slot Accounting System (SAS)
land — `theo hold %`, `handle pulls`, `coin-in`, `TITO tickets`, `bill
validator`, `WAP` (wide-area progressive). The shape demonstrates tiered
auto-layout, HA pair grouping, pool fan-out, and metric threshold colour
bands using real land-based-casino KPIs:

```
WAP Controller (wide-area progressive jackpot)
    |
    +-- Floor Gateway α (active)   --+  HA Pair
    +-- Floor Gateway β (passive)  --+
            |
    +-- SAS Poller North (active)  --+  HA Pair
    +-- SAS Poller South (standby) --+
            |
         Meter Aggregator -- Slot Bank 7
                               |
              +---+---+---+---+---+---+
          REEL-01 .. REEL-02 .. REEL-06
                     Slot Bank Cluster
```

The example ships with empty datasource queries — it's a visual demo. A
transient banner explains this after "Load example" is clicked, and
auto-dismisses after 12 seconds.

---

## Roadmap

**Shipped since v1.0.0** (roughly 55+ tasks across Phases 1–6, a PR-review-driven improvement plan, and five canvas-interaction phases for hover dim / edge popup / context menu / drag-to-connect / hit-test overlay):

- [x] **Multi-datasource support** — Prometheus, CloudWatch, and Infinity (any JSON HTTP API) via a unified `queryDatasource` abstraction
- [x] **Dynamic target query** — `DynamicTargetQuery` with virtual-edge expansion via `parentId::targetValue` convention, resolvers for all three datasource types
- [x] **Grafana alert rule integration** — `useAlertRules` hook + `alertLabelMatchers` on nodes, configurable poll cadence, runbook deep-links
- [x] **Freshness SLO** — per-metric `fetchedAt` stamping, configurable `metricFreshnessSLOSec`, live-ticking popup freshness labels, toolbar "N stale" indicator
- [x] **Multi-metric popups** — up to 4 summary metrics per popup with mini SVG sparklines and "Updated Ns ago" labels
- [x] **Observability drill-downs** — per-node `observabilityLinks` with `${token}` URL interpolation
- [x] **Import/export topology JSON** — full round-trip including `canvas`, `animation`, `layout`, `display` sub-options via cross-subtree event bus
- [x] **CloudWatch & Infinity editors** — namespace/metricName/dimensions/stat/period and url/method/body/rootSelector fields in `MetricEditor` and `EdgeCard`
- [x] **State map for non-numeric edges** — `stateMap` editor + `calculateEdgeStatus` support for string-valued metrics
- [x] **Zoom/pan with mouse wheel** + Fit-to-view + 1:1 reset + viewport persistence across panel remounts (module-level `viewportStore`)
- [x] **Neon glow animated edges** — double `drop-shadow` SVG filter on flow overlays
- [x] **Search filters** in NodesEditor, EdgesEditor, GroupsEditor
- [x] **Bulk node import** from Prometheus metric discovery
- [x] **Auto-delete orphan edges** when a node is deleted
- [x] **Double-click node** → scroll matching editor card into view
- [x] **Edit Node** button in popup (edit mode only)
- [x] **Example topology explainer banner** — 12s dismissible after "Load example"
- [x] **Mobile responsive layout** — `@media (max-width: 768px)` bottom-sheet popup, wrapped toolbar, `touch-action` pan/pinch-zoom
- [x] **Reduced-motion accessibility** — `@media (prefers-reduced-motion: reduce)` disables flow and pulse animations
- [x] **242 unit tests** across 12 suites (edges, layout, viewport, viewportStore, datasourceQuery, alertRules, dynamicTargets, panelEvents, NodePopup, EdgePopup, ContextMenu, TopologyPanel)
- [x] **GitHub Actions CI** — typecheck + lint + test + build on every push; tag-triggered signing workflow with env-driven `GRAFANA_ROOT_URLS` secret
- [x] **Cross-platform build** — `cross-env` shim so Windows CMD works with the `TS_NODE_COMPILER_OPTIONS` env var
- [x] **SVG overflow clipping fix** — edges past the layout box now render correctly after Auto Layout + Fit
- [x] **Z-order fix** — groups no longer occlude edges that cross their bounding box
- [x] **AbortController + 10s timeout** on all datasource queries so hung datasources don't freeze the panel
- [x] **Edge hit-test overlay layer** — dedicated invisible SVG layer so edges can receive pointer events without touching the visual pipeline (prerequisite for the four canvas interactions below)
- [x] **Edge hover dim** — hover any edge to fade every other edge to 20 % opacity and pause their flow animation; 180 ms transition skipped under `prefers-reduced-motion`
- [x] **Edge click → metric popup** — `EdgePopup` component with source→target header, current value, mini sparkline, and highlighted threshold band pill; fetches time-series via `queryDatasourceRange` with `AbortController`
- [x] **Right-click context menu on nodes and edges** — `ContextMenu` component with Duplicate / Copy id / Delete; edit-mode-only "Edit in sidebar" item routes through the `emitNodeEditRequest` / `emitEdgeEditRequest` pub/sub bus
- [x] **Drag-to-connect directly on canvas** — Shift+drag from one node to another in edit mode creates a new edge via `onOptionsChange` and auto-opens its card in the sidebar editor
- [x] **`emitEdgeEditRequest` cross-subtree channel** — 5th `panelEvents` pub/sub channel so `EdgesEditor` can subscribe and scroll+expand the matching edge card on request, mirror of the existing node-edit channel

**Partially shipped — needs follow-up:**

- [~] **Template variable support** — `replaceVariables` from `PanelProps` is threaded through `TopologyPanel → useSelfQueries → queryDatasource → replaceVars(query)` and applied to **Prometheus query strings** (`src/utils/datasourceQuery.ts:67`). **Not yet** applied to CloudWatch `queryConfig.namespace` / `metricName` / `dimensions` values, or to Infinity `queryConfig.url` / `body`. Extending the interpolation across all three datasource types is straightforward (map each string field through `replaceVars`) but hasn't been done.
- [~] **Plugin signing** — the release workflow in `.github/workflows/release.yml` already runs `@grafana/sign-plugin` on tag push with an env-driven `GRAFANA_ROOT_URLS` secret (Task 4.3 in the GA plan). The plugin build zip can be signed today. **Public Grafana catalog submission** itself is a separate manual process (submit the signed zip + `plugin.json` + metadata to Grafana Labs via their plugin submission form) and has not been done — the plugin is currently installed as an unsigned allowlisted plugin.

**Still on the roadmap:**

- [ ] **Light theme support** — the Nord dark palette is hard-coded in `TopologyPanel.css` and inline styles in the popup / context-menu components. A light theme variant would need a `useTheme2()` read from `@grafana/ui` plus palette tokens threaded through every hard-coded hex.

---

## License

[Apache License 2.0](LICENSE)

no copyright - Mindia Tulashvili
