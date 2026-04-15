import { PanelPlugin } from '@grafana/data';
import { TopologyPanel } from './components/TopologyPanel';
import { NodesEditor } from './editors/NodesEditor';
import { EdgesEditor } from './editors/EdgesEditor';
import { GroupsEditor } from './editors/GroupsEditor';
import { TopologyPanelOptions, DEFAULT_PANEL_OPTIONS } from './types';

export const plugin = new PanelPlugin<TopologyPanelOptions>(TopologyPanel)
  .setPanelOptions((builder) => {
    builder
      .addBooleanSwitch({
        path: 'canvas.showGrid',
        name: 'Show grid',
        description: 'Show dot grid background for positioning reference',
        defaultValue: DEFAULT_PANEL_OPTIONS.canvas.showGrid,
      })
      .addBooleanSwitch({
        path: 'canvas.snapToGrid',
        name: 'Snap to grid',
        description: 'Snap nodes to grid when dragging',
        defaultValue: DEFAULT_PANEL_OPTIONS.canvas.snapToGrid,
      })
      .addNumberInput({
        path: 'canvas.gridSize',
        name: 'Grid size',
        description: 'Grid spacing in pixels',
        defaultValue: DEFAULT_PANEL_OPTIONS.canvas.gridSize,
      })
      .addColorPicker({
        path: 'canvas.backgroundColor',
        name: 'Background color',
        description: 'Canvas background color ("transparent" inherits the dashboard theme)',
        defaultValue: DEFAULT_PANEL_OPTIONS.canvas.backgroundColor,
      })
      .addBooleanSwitch({
        path: 'animation.flowEnabled',
        name: 'Flow animation',
        description: 'Animate flow on traffic edges',
        defaultValue: DEFAULT_PANEL_OPTIONS.animation.flowEnabled,
      })
      .addBooleanSwitch({
        path: 'animation.pulseOnCritical',
        name: 'Pulse on critical',
        description: 'Pulse status dot when node is critical',
        defaultValue: DEFAULT_PANEL_OPTIONS.animation.pulseOnCritical,
      })
      .addSelect({
        path: 'animation.defaultFlowSpeed',
        name: 'Default flow speed',
        description: 'Panel-wide fallback flow speed for edges that do not set their own',
        defaultValue: DEFAULT_PANEL_OPTIONS.animation.defaultFlowSpeed,
        settings: {
          options: [
            { label: 'Auto', value: 'auto' },
            { label: 'Slow', value: 'slow' },
            { label: 'Normal', value: 'normal' },
            { label: 'Fast', value: 'fast' },
            { label: 'None', value: 'none' },
          ],
        },
      })
      .addNumberInput({
        path: 'animation.alertPollIntervalMs',
        name: 'Alert poll interval (ms)',
        description: 'How often to refresh Grafana alert state for matched nodes. Minimum 5000ms. Default 30000ms (30s).',
        defaultValue: DEFAULT_PANEL_OPTIONS.animation.alertPollIntervalMs,
        settings: { min: 5000, step: 1000 },
      })
      .addNumberInput({
        path: 'animation.metricFreshnessSLOSec',
        name: 'Metric freshness SLO (s)',
        description: 'Mark self-queried metric rows as Stale in the node popup when their fetchedAt age exceeds this many seconds. Default 60s.',
        defaultValue: DEFAULT_PANEL_OPTIONS.animation.metricFreshnessSLOSec,
        settings: { min: 5, step: 5 },
      })
      .addBooleanSwitch({
        path: 'layout.autoLayout',
        name: 'Auto layout',
        description: 'Automatically arrange nodes in tiers. When off, nodes use their stored position even when it is the default (100,100).',
        defaultValue: DEFAULT_PANEL_OPTIONS.layout.autoLayout,
      })
      .addSelect({
        path: 'layout.direction',
        name: 'Layout direction',
        description: 'Auto-layout flow direction',
        defaultValue: DEFAULT_PANEL_OPTIONS.layout.direction,
        settings: {
          options: [
            { label: 'Top to bottom', value: 'top-down' },
            { label: 'Left to right', value: 'left-right' },
          ],
        },
      })
      .addNumberInput({
        path: 'layout.tierSpacing',
        name: 'Tier spacing',
        description: 'Vertical space between tiers in auto-layout',
        defaultValue: DEFAULT_PANEL_OPTIONS.layout.tierSpacing,
      })
      .addNumberInput({
        path: 'layout.nodeSpacing',
        name: 'Node spacing',
        description: 'Horizontal space between nodes in same tier',
        defaultValue: DEFAULT_PANEL_OPTIONS.layout.nodeSpacing,
      })
      .addBooleanSwitch({
        path: 'display.showEdgeLabels',
        name: 'Show edge labels',
        description: 'Display metric values on edges',
        defaultValue: DEFAULT_PANEL_OPTIONS.display.showEdgeLabels,
      })
      .addBooleanSwitch({
        path: 'display.showNodeStatus',
        name: 'Show status dots',
        description: 'Show colored status indicator dots on nodes',
        defaultValue: DEFAULT_PANEL_OPTIONS.display.showNodeStatus,
      })
      .addNumberInput({
        path: 'display.maxSummaryMetrics',
        name: 'Max summary metrics',
        description: 'Number of metrics shown in collapsed node view (1-6)',
        defaultValue: DEFAULT_PANEL_OPTIONS.display.maxSummaryMetrics,
      })
      .addCustomEditor({
        id: 'topology-nodes',
        path: 'nodes',
        name: 'Nodes',
        editor: NodesEditor,
        category: ['Topology'],
      })
      .addCustomEditor({
        id: 'topology-edges',
        path: 'edges',
        name: 'Relationships',
        editor: EdgesEditor,
        category: ['Topology'],
      })
      .addCustomEditor({
        id: 'topology-groups',
        path: 'groups',
        name: 'Groups',
        editor: GroupsEditor,
        category: ['Topology'],
      });
  });
