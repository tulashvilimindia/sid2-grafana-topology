import { TopologyPanelOptions, ThresholdStep } from '../types';

/**
 * exampleTopology.ts — Example topology used by the "Load example" button
 * in TopologyPanel.
 *
 * Pure data module: no React, no state. Returns a Partial<TopologyPanelOptions>
 * containing 13 nodes, 13 edges, and 3 groups representing a land-based
 * casino's SAS (Slot Accounting System) floor network.
 *
 * The shape is: Wide-Area Progressive controller at the top, an HA pair of
 * Floor Network Gateways, an HA pair of SAS Pollers, a Meter Aggregator,
 * a Slot Bank pool, and 6 individual Electronic Gaming Machines (REEL-01
 * through REEL-06). All metrics ship with empty datasource/query strings
 * — the example is a visual demo; users wire real datasources to see live
 * data.
 *
 * The vocabulary (SAS, TITO, handle pulls, theo hold %, bill validator,
 * WAP controller) is specific to physical slot-machine operations (IGT/
 * Bally protocol land) and intentionally does not overlap with any online
 * player-management, payment, or brand-operations terminology.
 */

// Helper to type threshold colors as literal union
function t(value: number, color: 'green' | 'yellow' | 'red'): ThresholdStep {
  return { value, color };
}

export function getExampleTopology(): Partial<TopologyPanelOptions> {
  return {
    nodes: [
      {
        id: 'n-wap', name: 'WAP Controller', role: 'wide-area progressive', type: 'accelerator',
        position: { x: 245, y: 20 }, compact: false, width: 200,
        metrics: [
          { id: 'wap-jackpot', label: 'jackpot', datasourceUid: '', query: '', format: '$${value}', section: 'Progressive', isSummary: true, thresholds: [t(0, 'green'), t(250000, 'yellow'), t(500000, 'red')], showSparkline: true },
          { id: 'wap-contrib', label: 'contrib/min', datasourceUid: '', query: '', format: '$${value}', section: 'Progressive', isSummary: true, thresholds: [t(0, 'green')], showSparkline: false },
          { id: 'wap-seed', label: 'seed level', datasourceUid: '', query: '', format: '$${value}', section: 'Progressive', isSummary: false, thresholds: [t(0, 'green')], showSparkline: false },
          { id: 'wap-rtt', label: 'mesh rtt', datasourceUid: '', query: '', format: '${value}ms', section: 'Network', isSummary: false, thresholds: [t(0, 'green'), t(100, 'yellow'), t(250, 'red')], showSparkline: true },
        ],
      },
      {
        id: 'n-fg1', name: 'Floor Gateway α', role: 'active', type: 'firewall',
        position: { x: 70, y: 175 }, compact: false, width: 200, groupId: 'grp-fg',
        metrics: [
          { id: 'fg1-pps', label: 'sas pps', datasourceUid: '', query: '', format: '${value}', section: 'System', isSummary: true, thresholds: [t(0, 'green')], showSparkline: true },
          { id: 'fg1-cpu', label: 'cpu', datasourceUid: '', query: '', format: '${value}%', section: 'System', isSummary: true, thresholds: [t(0, 'green'), t(60, 'yellow'), t(80, 'red')], showSparkline: false },
          { id: 'fg1-drops', label: 'vlan drops', datasourceUid: '', query: '', format: '${value}', section: 'Network', isSummary: false, thresholds: [t(0, 'green'), t(1, 'yellow'), t(10, 'red')], showSparkline: false },
          { id: 'fg1-acl', label: 'acl hits', datasourceUid: '', query: '', format: '${value}', section: 'Network', isSummary: false, thresholds: [t(0, 'green')], showSparkline: true },
        ],
      },
      {
        id: 'n-fg2', name: 'Floor Gateway β', role: 'passive', type: 'firewall',
        position: { x: 400, y: 175 }, compact: false, width: 200, groupId: 'grp-fg',
        metrics: [
          { id: 'fg2-pps', label: 'sas pps', datasourceUid: '', query: '', format: '${value}', section: 'System', isSummary: true, thresholds: [t(0, 'green')], showSparkline: false },
          { id: 'fg2-cpu', label: 'cpu', datasourceUid: '', query: '', format: '${value}%', section: 'System', isSummary: true, thresholds: [t(0, 'green'), t(60, 'yellow'), t(80, 'red')], showSparkline: false },
          { id: 'fg2-sync', label: 'ha sync', datasourceUid: '', query: '', format: '${value}', section: 'HA', isSummary: false, thresholds: [], showSparkline: false },
        ],
      },
      {
        id: 'n-sp1', name: 'SAS Poller North', role: 'active', type: 'loadbalancer',
        position: { x: 70, y: 335 }, compact: false, width: 200, groupId: 'grp-sp',
        metrics: [
          { id: 'sp1-rtt', label: 'poll rtt', datasourceUid: '', query: '', format: '${value}ms', section: 'SAS', isSummary: true, thresholds: [t(0, 'green'), t(80, 'yellow'), t(150, 'red')], showSparkline: true },
          { id: 'sp1-reads', label: 'meter reads', datasourceUid: '', query: '', format: '${value}/s', section: 'SAS', isSummary: true, thresholds: [t(0, 'green')], showSparkline: false },
          { id: 'sp1-online', label: 'emgs online', datasourceUid: '', query: '', format: '${value}', section: 'SAS', isSummary: false, thresholds: [], showSparkline: false },
          { id: 'sp1-poll-err', label: 'poll errors', datasourceUid: '', query: '', format: '${value}', section: 'SAS', isSummary: false, thresholds: [t(0, 'green'), t(1, 'yellow'), t(5, 'red')], showSparkline: false },
        ],
      },
      {
        id: 'n-sp2', name: 'SAS Poller South', role: 'standby', type: 'loadbalancer',
        position: { x: 400, y: 335 }, compact: false, width: 200, groupId: 'grp-sp',
        metrics: [
          { id: 'sp2-rtt', label: 'poll rtt', datasourceUid: '', query: '', format: '${value}ms', section: 'SAS', isSummary: true, thresholds: [t(0, 'green'), t(80, 'yellow'), t(150, 'red')], showSparkline: false },
          { id: 'sp2-reads', label: 'meter reads', datasourceUid: '', query: '', format: '${value}/s', section: 'SAS', isSummary: true, thresholds: [t(0, 'green')], showSparkline: false },
          { id: 'sp2-online', label: 'emgs online', datasourceUid: '', query: '', format: '${value}', section: 'SAS', isSummary: false, thresholds: [], showSparkline: false },
          { id: 'sp2-sync', label: 'ha sync', datasourceUid: '', query: '', format: '${value}', section: 'HA', isSummary: false, thresholds: [], showSparkline: false },
        ],
      },
      {
        id: 'n-ma', name: 'Meter Aggregator', role: 'coin-in collector', type: 'virtualserver',
        position: { x: 175, y: 470 }, compact: false, width: 180,
        metrics: [
          { id: 'ma-coinin', label: 'coin-in/min', datasourceUid: '', query: '', format: '$${value}', section: 'Revenue', isSummary: true, thresholds: [t(0, 'green')], showSparkline: true },
          { id: 'ma-theo', label: 'theo hold', datasourceUid: '', query: '', format: '${value}%', section: 'Revenue', isSummary: true, thresholds: [t(0, 'green'), t(12, 'yellow'), t(15, 'red')], showSparkline: false },
          { id: 'ma-tito', label: 'tito printed', datasourceUid: '', query: '', format: '${value}', section: 'Revenue', isSummary: false, thresholds: [t(0, 'green')], showSparkline: true },
          { id: 'ma-bv-err', label: 'bv errors', datasourceUid: '', query: '', format: '${value}', section: 'Hardware', isSummary: false, thresholds: [t(0, 'green'), t(1, 'yellow'), t(5, 'red')], showSparkline: false },
        ],
      },
      {
        id: 'n-bank', name: 'Slot Bank 7', role: '6/6 online', type: 'pool',
        position: { x: 370, y: 470 }, compact: false, width: 160,
        metrics: [
          { id: 'bank-up', label: 'online', datasourceUid: '', query: '', format: '${value}', section: 'Pool', isSummary: true, thresholds: [t(0, 'green')], showSparkline: false },
          { id: 'bank-tilt', label: 'tilts', datasourceUid: '', query: '', format: '${value}', section: 'Pool', isSummary: true, thresholds: [t(0, 'green'), t(1, 'yellow'), t(3, 'red')], showSparkline: false },
          { id: 'bank-denom', label: 'denom mix', datasourceUid: '', query: '', format: '${value}', section: 'Pool', isSummary: false, thresholds: [], showSparkline: false },
          { id: 'bank-health', label: 'health', datasourceUid: '', query: '', format: '${value}', section: 'Monitor', isSummary: false, thresholds: [], showSparkline: false },
        ],
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `n-reel${i + 1}`, name: `REEL-0${i + 1}`, role: '', type: 'server' as const,
        position: { x: 15 + i * 110, y: 570 }, compact: true, width: 100, groupId: 'grp-bank',
        metrics: [
          { id: `reel${i + 1}-pulls`, label: 'pulls/min', datasourceUid: '', query: '', format: '${value}', section: 'Play', isSummary: true, thresholds: [t(0, 'green')], showSparkline: false },
          { id: `reel${i + 1}-hold`, label: 'actual hold', datasourceUid: '', query: '', format: '${value}%', section: 'Play', isSummary: true, thresholds: [t(0, 'green'), t(12, 'yellow'), t(15, 'red')], showSparkline: false },
          { id: `reel${i + 1}-coin`, label: 'coin-in', datasourceUid: '', query: '', format: '$${value}', section: 'Play', isSummary: false, thresholds: [t(0, 'green')], showSparkline: true },
          { id: `reel${i + 1}-tilt`, label: 'tilts', datasourceUid: '', query: '', format: '${value}', section: 'Hardware', isSummary: false, thresholds: [t(0, 'green'), t(1, 'yellow'), t(3, 'red')], showSparkline: false },
        ],
      })),
    ],
    edges: [
      { id: 'e-wap-fg1', sourceId: 'n-wap', targetId: 'n-fg1', type: 'traffic', thicknessMode: 'proportional', thicknessMin: 1.5, thicknessMax: 4, thresholds: [t(0, 'green')], flowAnimation: true, flowSpeed: 'auto', bidirectional: false, anchorSource: 'auto', anchorTarget: 'auto', labelTemplate: '18.2k sas pps' },
      { id: 'e-wap-fg2', sourceId: 'n-wap', targetId: 'n-fg2', type: 'traffic', thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4, thresholds: [t(0, 'green')], flowAnimation: true, flowSpeed: 'slow', bidirectional: false, anchorSource: 'auto', anchorTarget: 'auto', labelTemplate: 'standby' },
      { id: 'e-fg1-sp1', sourceId: 'n-fg1', targetId: 'n-sp1', type: 'traffic', thicknessMode: 'proportional', thicknessMin: 1.5, thicknessMax: 4, thresholds: [t(0, 'green')], flowAnimation: true, flowSpeed: 'fast', bidirectional: false, anchorSource: 'auto', anchorTarget: 'auto', labelTemplate: '34.6k polls/s' },
      { id: 'e-fg2-sp2', sourceId: 'n-fg2', targetId: 'n-sp2', type: 'traffic', thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4, thresholds: [t(0, 'green')], flowAnimation: true, flowSpeed: 'slow', bidirectional: false, anchorSource: 'auto', anchorTarget: 'auto', labelTemplate: 'standby' },
      { id: 'e-sp1-ma', sourceId: 'n-sp1', targetId: 'n-ma', type: 'traffic', thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4, thresholds: [t(0, 'green')], flowAnimation: true, flowSpeed: 'normal', bidirectional: false, anchorSource: 'auto', anchorTarget: 'auto' },
      { id: 'e-sp2-ma', sourceId: 'n-sp2', targetId: 'n-ma', type: 'traffic', thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4, thresholds: [t(0, 'green')], flowAnimation: true, flowSpeed: 'slow', bidirectional: false, anchorSource: 'auto', anchorTarget: 'auto' },
      { id: 'e-ma-bank', sourceId: 'n-ma', targetId: 'n-bank', type: 'traffic', thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4, thresholds: [t(0, 'green')], flowAnimation: true, flowSpeed: 'normal', bidirectional: false, anchorSource: 'auto', anchorTarget: 'auto', labelTemplate: '128 emgs' },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `e-bank-reel${i + 1}`, sourceId: 'n-bank', targetId: `n-reel${i + 1}`, type: 'traffic' as const,
        thicknessMode: 'fixed' as const, thicknessMin: 1.5, thicknessMax: 4,
        thresholds: [t(0, 'green')],
        flowAnimation: true, flowSpeed: 'auto' as const,
        bidirectional: false, anchorSource: 'auto' as const, anchorTarget: 'auto' as const,
      })),
    ],
    groups: [
      { id: 'grp-fg', label: 'HA — Floor Gateways', type: 'ha_pair', nodeIds: ['n-fg1', 'n-fg2'], style: 'dashed' },
      { id: 'grp-sp', label: 'HA — SAS Pollers', type: 'ha_pair', nodeIds: ['n-sp1', 'n-sp2'], style: 'dashed' },
      { id: 'grp-bank', label: 'Slot Bank 7', type: 'cluster', nodeIds: ['n-reel1', 'n-reel2', 'n-reel3', 'n-reel4', 'n-reel5', 'n-reel6'], style: 'dashed' },
    ],
  };
}
