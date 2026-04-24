# Changelog

## 1.0.1 - 2026-04-24

Bug fixes, narrowed status-propagation semantics, and a large test-surface
expansion (304 → 480 Jest tests, + 3 E2E specs).

### Fixed

- **Viewport no longer resets on edit↔view toggle** (`TopologyCanvas.tsx`).
  An unmount-scoped cleanup was clearing the per-panel viewport store on
  every remount, which defeated the store's entire purpose. Pan/zoom now
  survives the remount as originally intended.
- **CloudWatch `region` picker now reaches the API.** `queryDatasource`
  was hardcoding `region: 'default'` in the `/api/ds/query` body, silently
  ignoring the user's editor-side region selection. Both the instant and
  range query paths now forward `config.region || 'default'`.
- **Pan-gesture closure race under React 18 batching.** `handleMove`
  dereferenced `panStartRef.current` inside a `setViewport` updater
  lambda, which could race with `handleUp` nulling the ref between
  scheduling and flush. Now snapshots the ref into primitives before
  calling `setViewport`.
- **`%VERSION%`/`%TODAY%` placeholders** are now substituted at build
  time as the webpack plugin registration intended. `src/plugin.json`
  previously held literal values that made the substitution a no-op.
- **Documented BFS `queued`-set guard in `assignTiers`** now has a
  dedicated diamond fan-in regression test (A→B, A→C, B→D, C→D) so a
  future cleanup can't silently reintroduce the O(N²) regression.

### Added

- **`node.description` / `edge.description` are now rendered** in
  NodePopup and EdgePopup when set. The `Notes / Annotation` TextArea
  in the editors was previously write-only.
- **E2E scaffolding** via `@grafana/plugin-e2e` + Playwright at the repo
  root. 3 smoke specs in `e2e/` exercise plugin discoverability. Run via
  `npm run e2e` against the Docker dev stack.
- **480-test Jest suite across 30 files** (was 304 across 17). New
  coverage: all 3 hooks (`useSelfQueries`, `useAlertRules` incl. the
  5000ms anti-DoS clamp regression, `useDynamicTargets`), all 9 editor
  components (NodeCard, EdgeCard, MetricEditor, NodesEditor,
  EdgesEditor, GroupCard, GroupsEditor, ThresholdList, editorUtils),
  direct unit tests for `cloudwatchResources`, and gap-fill coverage in
  every existing suite (context-menu clipboard, focus-trap inactive
  path, alertRules undefined branches, dynamicTargets regex-escape,
  datasourceQuery 10s timeout).

### Changed

- **`propagateStatus` narrowed to `critical` / `degraded` / `down` only.**
  `warning` and `saturated` no longer propagate degraded colour upstream.
  Broad propagation flooded dense topologies with yellow edges and
  buried the critical path. Matches the function's documented intent.

### Developer experience

- New npm scripts: `npm run e2e`, `npm run e2e:list`, `npm run analyze`.
- `playwright.config.ts` at repo root with `GRAFANA_URL` env override.

## 1.0.0 - 2026-04-15

- Initial release of E2E Topology panel plugin
- Interactive SVG topology canvas with bezier edges
- Drag-and-drop node positioning with snap-to-grid
- Animated flow connections
- Click-to-expand metric panels per node
- HA pair and cluster group containers
- Auto-layout via topological sort
- Example topology (sample E2E infrastructure stack)
- Nord-inspired dark theme
