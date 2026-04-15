import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Button, Input } from '@grafana/ui';
import { TopologyPanelOptions, TopologyEdge, DEFAULT_EDGE } from '../types';
import { EdgeCard } from './components/EdgeCard';
import { generateId } from './utils/editorUtils';
import { onEdgeEditRequest, EdgeEditSection } from '../utils/panelEvents';
import './editors.css';

type Props = StandardEditorProps<TopologyEdge[], object, TopologyPanelOptions>;

export const EdgesEditor: React.FC<Props> = ({ value, onChange, context }) => {
  // Stable references via useMemo so useCallback deps don't fire on every parent render
  const edges = useMemo(() => value || [], [value]);
  const nodes = useMemo(() => context.options?.nodes || [], [context.options?.nodes]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState('');
  // Sticky per-edge section hint (mirror of NodesEditor pattern)
  const [sectionHintByEdge, setSectionHintByEdge] = useState<Map<string, EdgeEditSection | undefined>>(new Map());

  // Filter edges by source/target node name, type, or id. Node-name lookup
  // uses a Map so the filter stays O(E) instead of O(E*N).
  const filteredEdges = useMemo(() => {
    if (!filterText) { return edges; }
    const lower = filterText.toLowerCase();
    const nameById = new Map(nodes.map((n) => [n.id, n.name.toLowerCase()]));
    return edges.filter((e) => {
      const sourceId = e.sourceId || '';
      const targetId = e.targetId || '';
      const sourceName = nameById.get(sourceId) || '';
      const targetName = nameById.get(targetId) || '';
      return (
        sourceName.includes(lower) ||
        targetName.includes(lower) ||
        sourceId.toLowerCase().includes(lower) ||
        targetId.toLowerCase().includes(lower) ||
        e.type.toLowerCase().includes(lower)
      );
    });
  }, [edges, nodes, filterText]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  // Canvas edge-card refs for scroll-into-view on edge edit requests (mirror
  // of the NodesEditor pattern). The TopologyPanel right-click context menu
  // and edge popup both emit emitEdgeEditRequest when the user asks to edit
  // an edge — we scroll and expand the matching card here.
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    return onEdgeEditRequest((edgeId, section) => {
      setExpandedIds((prev) => {
        if (prev.has(edgeId)) { return prev; }
        const next = new Set(prev);
        next.add(edgeId);
        return next;
      });
      setSectionHintByEdge((prev) => {
        const next = new Map(prev);
        next.set(edgeId, section);
        return next;
      });
      setTimeout(() => {
        const el = cardRefs.current.get(edgeId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    });
  }, []);

  const handleAdd = useCallback(() => {
    const newEdge: TopologyEdge = {
      ...(DEFAULT_EDGE as TopologyEdge),
      id: generateId('e'),
      sourceId: nodes.length > 0 ? nodes[0].id : '',
      targetId: nodes.length > 1 ? nodes[1].id : '',
    };
    onChange([...edges, newEdge]);
    setExpandedIds((prev) => new Set(prev).add(newEdge.id));
  }, [edges, nodes, onChange]);

  const handleChange = useCallback(
    (updated: TopologyEdge) => {
      onChange(edges.map((e) => (e.id === updated.id ? updated : e)));
    },
    [edges, onChange]
  );

  const handleDelete = useCallback(
    (id: string) => {
      onChange(edges.filter((e) => e.id !== id));
    },
    [edges, onChange]
  );

  const handleDuplicate = useCallback(
    (edge: TopologyEdge) => {
      const dup: TopologyEdge = {
        ...edge,
        id: generateId('e'),
      };
      onChange([...edges, dup]);
      setExpandedIds((prev) => new Set(prev).add(dup.id));
    },
    [edges, onChange]
  );

  return (
    <div>
      <div className="topo-editor-header">
        <span className="topo-editor-header-title">
          Relationships<span className="topo-editor-count">({edges.length})</span>
        </span>
        <Button size="sm" variant="secondary" icon="plus" onClick={handleAdd}>
          Add
        </Button>
      </div>
      {edges.length > 3 && (
        <div className="topo-editor-field">
          <Input
            value={filterText}
            onChange={(e) => setFilterText(e.currentTarget.value)}
            placeholder="Filter edges by source, target, or type..."
            prefix={<span style={{ fontSize: 10, color: '#616e88' }}>Search</span>}
          />
        </div>
      )}
      {edges.length === 0 && (
        <div className="topo-editor-empty">No relationships defined. Add edges to connect nodes.</div>
      )}
      {filterText && filteredEdges.length === 0 && (
        <div className="topo-editor-empty">No edges match &quot;{filterText}&quot;</div>
      )}
      {filteredEdges.map((edge) => (
        <div
          key={edge.id}
          ref={(el) => {
            if (el) {
              cardRefs.current.set(edge.id, el);
            } else {
              cardRefs.current.delete(edge.id);
            }
          }}
        >
          <EdgeCard
            edge={edge}
            nodes={nodes}
            isOpen={expandedIds.has(edge.id)}
            onToggle={() => toggleExpand(edge.id)}
            onChange={handleChange}
            onDelete={() => handleDelete(edge.id)}
            onDuplicate={() => handleDuplicate(edge)}
            sectionHint={sectionHintByEdge.get(edge.id)}
          />
        </div>
      ))}
    </div>
  );
};
