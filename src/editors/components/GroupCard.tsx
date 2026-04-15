import React, { useCallback, useMemo } from 'react';
import { CollapsableSection, Input, RadioButtonGroup, IconButton, Select } from '@grafana/ui';
import { NodeGroup, TopologyNode } from '../../types';
import { getNodeSelectOptions } from '../utils/editorUtils';
import '../editors.css';

const GROUP_TYPES = [
  { label: 'HA pair', value: 'ha_pair' as const },
  { label: 'Cluster', value: 'cluster' as const },
  { label: 'Pool', value: 'pool' as const },
  { label: 'Custom', value: 'custom' as const },
];

const GROUP_STYLES = [
  { label: 'Dashed', value: 'dashed' as const },
  { label: 'Solid', value: 'solid' as const },
  { label: 'None', value: 'none' as const },
];

interface Props {
  group: NodeGroup;
  nodes: TopologyNode[];
  isOpen: boolean;
  onToggle: () => void;
  onChange: (updated: NodeGroup) => void;
  onDelete: () => void;
}

export const GroupCard: React.FC<Props> = ({ group, nodes, isOpen, onToggle, onChange, onDelete }) => {
  const nodeOptions = useMemo(() => getNodeSelectOptions(nodes), [nodes]);
  const selectedMembers = useMemo(
    () => nodeOptions.filter((o) => group.nodeIds.includes(o.value)),
    [nodeOptions, group.nodeIds]
  );

  const handleField = useCallback(
    <K extends keyof NodeGroup>(field: K, value: NodeGroup[K]) => {
      onChange({ ...group, [field]: value });
    },
    [group, onChange]
  );

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      <span>{group.label || 'Untitled group'}</span>
      <div className="topo-editor-card-actions">
        <IconButton name="trash-alt" size="sm" onClick={onDelete} tooltip="Delete group" />
      </div>
    </div>
  );

  return (
    <div className="topo-editor-card">
      <CollapsableSection label={header} isOpen={isOpen} onToggle={onToggle}>
        <div className="topo-editor-field">
          <label>Label</label>
          <Input value={group.label} onChange={(e) => handleField('label', e.currentTarget.value)} placeholder="Group name" />
        </div>
        <div className="topo-editor-field">
          <label>Type</label>
          <RadioButtonGroup options={GROUP_TYPES} value={group.type} onChange={(v) => handleField('type', v)} size="sm" />
        </div>
        <div className="topo-editor-field">
          <label>Style</label>
          <RadioButtonGroup options={GROUP_STYLES} value={group.style} onChange={(v) => handleField('style', v)} size="sm" />
        </div>
        <div className="topo-editor-field">
          <label>Members</label>
          <Select
            isMulti
            options={nodeOptions}
            value={selectedMembers}
            onChange={(selected) => handleField('nodeIds', (selected || []).map((s: { value: string }) => s.value))}
            placeholder="Select nodes..."
          />
        </div>
      </CollapsableSection>
    </div>
  );
};
