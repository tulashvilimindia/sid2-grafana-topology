import { TopologyNode, NodeGroup, NODE_TYPE_CONFIG, NodeType } from '../../types';

/** Sanitize a value for safe PromQL label interpolation — strips characters that could inject matchers */
export function sanitizeLabel(value: string): string {
  return value.replace(/["{}\\\n\r]/g, '');
}

/** Generate a unique ID with prefix (e.g. 'n-k1abc', 'e-k2def') — uses timestamp to survive hot reloads */
export function generateId(prefix: string): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${prefix}-${time}${random}`;
}

/** Build Select options from nodes array */
export function getNodeSelectOptions(nodes: TopologyNode[]): Array<{ label: string; value: string; description?: string }> {
  return nodes.map((n) => ({
    label: `${NODE_TYPE_CONFIG[n.type]?.icon || '?'} ${n.name}`,
    value: n.id,
    description: n.role,
  }));
}

/** Build Select options for node types */
export function getNodeTypeOptions(): Array<{ label: string; value: NodeType }> {
  return (Object.entries(NODE_TYPE_CONFIG) as Array<[NodeType, { icon: string; defaultRole: string }]>).map(
    ([value, config]) => ({
      label: `${config.icon} — ${value}`,
      value,
    })
  );
}

/** Build Select options for groups */
export function getGroupSelectOptions(groups: NodeGroup[]): Array<{ label: string; value: string }> {
  return [
    { label: '-- none --', value: '' },
    ...groups.map((g) => ({ label: g.label, value: g.id })),
  ];
}

/** Find group a node belongs to */
export function findNodeGroup(nodeId: string, groups: NodeGroup[]): NodeGroup | undefined {
  return groups.find((g) => g.nodeIds.includes(nodeId));
}

/** Get node name by ID */
export function getNodeName(nodeId: string, nodes: TopologyNode[]): string {
  return nodes.find((n) => n.id === nodeId)?.name || nodeId;
}
