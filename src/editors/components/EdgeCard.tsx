import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { CollapsableSection, Input, Select, Checkbox, IconButton, RadioButtonGroup, TextArea, Button } from '@grafana/ui';
import { DataSourcePicker, getDataSourceSrv } from '@grafana/runtime';
import { TopologyEdge, TopologyNode, FlowSpeed, DatasourceQueryConfig, EdgeMetricConfig } from '../../types';
import { ThresholdList } from './ThresholdList';
import { getNodeSelectOptions } from '../utils/editorUtils';
import { EdgeEditSection } from '../../utils/panelEvents';
import '../editors.css';

const CLOUDWATCH_STATS = [
  { label: 'Average', value: 'Average' },
  { label: 'Sum', value: 'Sum' },
  { label: 'Maximum', value: 'Maximum' },
  { label: 'Minimum', value: 'Minimum' },
  { label: 'SampleCount', value: 'SampleCount' },
  { label: 'p50', value: 'p50' },
  { label: 'p90', value: 'p90' },
  { label: 'p95', value: 'p95' },
  { label: 'p99', value: 'p99' },
];

const INFINITY_METHODS = [
  { label: 'GET', value: 'GET' },
  { label: 'POST', value: 'POST' },
];

const STATE_MAP_COLORS: Array<{ label: string; value: 'green' | 'yellow' | 'red' }> = [
  { label: 'Green', value: 'green' },
  { label: 'Yellow', value: 'yellow' },
  { label: 'Red', value: 'red' },
];

const EDGE_TYPES = [
  { label: 'Traffic', value: 'traffic' as const },
  { label: 'HA sync', value: 'ha_sync' as const },
  { label: 'Failover', value: 'failover' as const },
  { label: 'Monitor', value: 'monitor' as const },
  { label: 'Response', value: 'response' as const },
  { label: 'Custom', value: 'custom' as const },
];

const THICKNESS_MODES = [
  { label: 'Fixed', value: 'fixed' as const },
  { label: 'Proportional', value: 'proportional' as const },
  { label: 'Threshold', value: 'threshold' as const },
];

const FLOW_SPEEDS: Array<{ label: string; value: 'auto' | 'slow' | 'normal' | 'fast' | 'none' | ''; description?: string }> = [
  { label: 'Inherit', value: '', description: 'Use panel animation.defaultFlowSpeed' },
  { label: 'Auto', value: 'auto', description: 'Faster animation with higher metric values' },
  { label: 'Slow', value: 'slow' },
  { label: 'Normal', value: 'normal' },
  { label: 'Fast', value: 'fast' },
  { label: 'None', value: 'none' },
];

const ANCHORS = [
  { label: 'Auto', value: 'auto' as const },
  { label: 'Top', value: 'top' as const },
  { label: 'Bottom', value: 'bottom' as const },
  { label: 'Left', value: 'left' as const },
  { label: 'Right', value: 'right' as const },
];

interface Props {
  edge: TopologyEdge;
  nodes: TopologyNode[];
  isOpen: boolean;
  onToggle: () => void;
  onChange: (updated: TopologyEdge) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  /** Programmatically expand a sub-section when a section-targeted edit request lands. */
  sectionHint?: EdgeEditSection;
}

export const EdgeCard: React.FC<Props> = ({ edge, nodes, isOpen, onToggle, onChange, onDelete, onDuplicate, sectionHint }) => {
  const [showMetric, setShowMetric] = useState(false);
  const [showVisual, setShowVisual] = useState(false);
  const [showThresholds, setShowThresholds] = useState(false);
  const [showStateMap, setShowStateMap] = useState(false);

  // Open the matching sub-section when a section-targeted edit request
  // arrives via EdgesEditor. Only acts when the card is already open.
  useEffect(() => {
    if (!isOpen || !sectionHint) { return; }
    if (sectionHint === 'metric') {
      setShowMetric(true);
    } else if (sectionHint === 'thresholds') {
      setShowThresholds(true);
    } else if (sectionHint === 'stateMap') {
      setShowStateMap(true);
    } else if (sectionHint === 'visual') {
      setShowVisual(true);
    }
  }, [isOpen, sectionHint]);

  const nodeOptions = useMemo(() => getNodeSelectOptions(nodes), [nodes]);

  const sourceName = useMemo(() => nodes.find((n) => n.id === edge.sourceId)?.name || edge.sourceId, [nodes, edge.sourceId]);
  const targetName = useMemo(
    () => nodes.find((n) => n.id === edge.targetId)?.name || edge.targetId || '?',
    [nodes, edge.targetId]
  );

  const handleField = useCallback(
    <K extends keyof TopologyEdge>(field: K, value: TopologyEdge[K]) => {
      onChange({ ...edge, [field]: value });
    },
    [edge, onChange]
  );

  const handleMetricField = useCallback(
    (field: keyof NonNullable<TopologyEdge['metric']>, value: string) => {
      onChange({
        ...edge,
        metric: { ...(edge.metric || { datasourceUid: '', query: '', alias: '' }), [field]: value },
      });
    },
    [edge, onChange]
  );

  // ─── Dynamic target query handlers ───
  const handleTargetQueryField = useCallback(
    (field: 'datasourceUid' | 'query' | 'nodeIdLabel', value: string) => {
      const existing = edge.targetQuery || { datasourceUid: '', query: '', nodeIdLabel: '' };
      onChange({
        ...edge,
        targetQuery: { ...existing, [field]: value },
      });
    },
    [edge, onChange]
  );

  const toggleDynamicTargets = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        // Turn on — seed an empty targetQuery and clear the static targetId
        onChange({
          ...edge,
          targetQuery: edge.targetQuery || { datasourceUid: '', query: '', nodeIdLabel: '' },
          targetId: undefined,
        });
      } else {
        // Turn off — drop targetQuery; user can pick a static targetId again
        onChange({
          ...edge,
          targetQuery: undefined,
        });
      }
    },
    [edge, onChange]
  );

  const isDynamic = !!edge.targetQuery;

  // ─── Target-query datasource type discovery ───
  const [targetDsType, setTargetDsType] = useState<string>('');
  useEffect(() => {
    const uid = edge.targetQuery?.datasourceUid;
    if (!uid) { setTargetDsType(''); return; }
    let cancelled = false;
    getDataSourceSrv().get(uid)
      .then((ds) => { if (!cancelled) { setTargetDsType(ds.type); } })
      .catch(() => { if (!cancelled) { setTargetDsType(''); } });
    return () => { cancelled = true; };
  }, [edge.targetQuery?.datasourceUid]);

  // ─── Patch a field on edge.targetQuery.queryConfig ───
  const updateTargetQueryConfig = useCallback(
    <K extends keyof DatasourceQueryConfig>(field: K, value: DatasourceQueryConfig[K]) => {
      const existing = edge.targetQuery || { datasourceUid: '', query: '', nodeIdLabel: '' };
      const nextConfig: DatasourceQueryConfig = { ...(existing.queryConfig || {}) };
      if (value === undefined || value === '') {
        delete nextConfig[field];
      } else {
        nextConfig[field] = value;
      }
      onChange({
        ...edge,
        targetQuery: {
          ...existing,
          queryConfig: Object.keys(nextConfig).length > 0 ? nextConfig : undefined,
        },
      });
    },
    [edge, onChange]
  );

  // ─── Target-query CloudWatch filter dimensions (separate from metric dimensions) ───
  const [targetDimEntries, setTargetDimEntries] = useState<Array<{ key: string; value: string }>>(
    () => Object.entries(edge.targetQuery?.queryConfig?.dimensions || {}).map(([key, value]) => ({ key, value }))
  );

  const syncTargetDimensions = useCallback((next: Array<{ key: string; value: string }>) => {
    setTargetDimEntries(next);
    const obj: Record<string, string> = {};
    next.forEach(({ key, value }) => {
      if (key) { obj[key] = value; }
    });
    updateTargetQueryConfig('dimensions', Object.keys(obj).length > 0 ? obj : undefined);
  }, [updateTargetQueryConfig]);

  const addTargetDim = useCallback(() => {
    syncTargetDimensions([...targetDimEntries, { key: '', value: '' }]);
  }, [targetDimEntries, syncTargetDimensions]);

  const updateTargetDim = useCallback((idx: number, field: 'key' | 'value', val: string) => {
    syncTargetDimensions(targetDimEntries.map((d, i) => (i === idx ? { ...d, [field]: val } : d)));
  }, [targetDimEntries, syncTargetDimensions]);

  const removeTargetDim = useCallback((idx: number) => {
    syncTargetDimensions(targetDimEntries.filter((_, i) => i !== idx));
  }, [targetDimEntries, syncTargetDimensions]);

  // ─── Datasource type discovery (mirrors MetricEditor pattern) ───
  const [dsType, setDsType] = useState<string>('');
  useEffect(() => {
    if (!edge.metric?.datasourceUid) { setDsType(''); return; }
    let cancelled = false;
    getDataSourceSrv().get(edge.metric.datasourceUid)
      .then((ds) => { if (!cancelled) { setDsType(ds.type); } })
      .catch(() => { if (!cancelled) { setDsType(''); } });
    return () => { cancelled = true; };
  }, [edge.metric?.datasourceUid]);

  // ─── Patch a single queryConfig field on edge.metric.queryConfig ───
  const updateMetricQueryConfig = useCallback(
    <K extends keyof DatasourceQueryConfig>(field: K, value: DatasourceQueryConfig[K]) => {
      const currentMetric: EdgeMetricConfig = edge.metric || { datasourceUid: '', query: '', alias: '' };
      const nextConfig: DatasourceQueryConfig = { ...(currentMetric.queryConfig || {}) };
      if (value === undefined || value === '') {
        delete nextConfig[field];
      } else {
        nextConfig[field] = value;
      }
      onChange({
        ...edge,
        metric: {
          ...currentMetric,
          queryConfig: Object.keys(nextConfig).length > 0 ? nextConfig : undefined,
        },
      });
    },
    [edge, onChange]
  );

  // ─── CloudWatch dimensions: local state for key/value list editor focus stability ───
  const [dimEntries, setDimEntries] = useState<Array<{ key: string; value: string }>>(
    () => Object.entries(edge.metric?.queryConfig?.dimensions || {}).map(([key, value]) => ({ key, value }))
  );

  const syncDimensions = useCallback(
    (next: Array<{ key: string; value: string }>) => {
      setDimEntries(next);
      const obj: Record<string, string> = {};
      next.forEach(({ key, value }) => {
        if (key) { obj[key] = value; }
      });
      updateMetricQueryConfig('dimensions', Object.keys(obj).length > 0 ? obj : undefined);
    },
    [updateMetricQueryConfig]
  );

  const addDim = useCallback(() => {
    syncDimensions([...dimEntries, { key: '', value: '' }]);
  }, [dimEntries, syncDimensions]);

  const updateDim = useCallback((idx: number, field: 'key' | 'value', val: string) => {
    syncDimensions(dimEntries.map((d, i) => (i === idx ? { ...d, [field]: val } : d)));
  }, [dimEntries, syncDimensions]);

  const removeDim = useCallback((idx: number) => {
    syncDimensions(dimEntries.filter((_, i) => i !== idx));
  }, [dimEntries, syncDimensions]);

  // ─── State map (categorical metric → color) ───
  const [stateMapEntries, setStateMapEntries] = useState<Array<{ key: string; color: 'green' | 'yellow' | 'red' }>>(
    () => Object.entries(edge.stateMap || {})
      .map(([key, color]) => ({ key, color: (color === 'yellow' || color === 'red' ? color : 'green') as 'green' | 'yellow' | 'red' }))
  );

  const syncStateMap = useCallback((next: Array<{ key: string; color: 'green' | 'yellow' | 'red' }>) => {
    setStateMapEntries(next);
    const obj: Record<string, string> = {};
    next.forEach(({ key, color }) => {
      if (key) { obj[key] = color; }
    });
    onChange({ ...edge, stateMap: Object.keys(obj).length > 0 ? obj : undefined });
  }, [edge, onChange]);

  const addStateMap = useCallback(() => {
    syncStateMap([...stateMapEntries, { key: '', color: 'green' }]);
  }, [stateMapEntries, syncStateMap]);

  const updateStateMapKey = useCallback((idx: number, key: string) => {
    syncStateMap(stateMapEntries.map((e, i) => (i === idx ? { ...e, key } : e)));
  }, [stateMapEntries, syncStateMap]);

  const updateStateMapColor = useCallback((idx: number, color: 'green' | 'yellow' | 'red') => {
    syncStateMap(stateMapEntries.map((e, i) => (i === idx ? { ...e, color } : e)));
  }, [stateMapEntries, syncStateMap]);

  const removeStateMap = useCallback((idx: number) => {
    syncStateMap(stateMapEntries.filter((_, i) => i !== idx));
  }, [stateMapEntries, syncStateMap]);

  // Resync the three local state mirrors (targetDimEntries, dimEntries,
  // stateMapEntries) whenever the underlying edge identity swaps OR the
  // user toggles dynamic targets off. Without this:
  // - Filter/search reusing an EdgeCard instance with a different edge
  //   leaves stale dimensions visible while handleField writes new data
  // - Disabling dynamic targets clears edge.targetQuery but leaves stale
  //   targetDimEntries in local state, which resurrects on re-enable or
  //   addTargetDim. Silent data-loss path (Task 1.3).
  // We deliberately depend ONLY on [edge.id, isDynamic], not the underlying
  // edge.metric/targetQuery/stateMap fields — those are written via the
  // handlers above and listing them here would overwrite in-flight edits.
  useEffect(() => {
    if (isDynamic) {
      setTargetDimEntries(
        Object.entries(edge.targetQuery?.queryConfig?.dimensions || {})
          .map(([key, value]) => ({ key, value }))
      );
    } else {
      setTargetDimEntries([]);
    }
    setDimEntries(
      Object.entries(edge.metric?.queryConfig?.dimensions || {})
        .map(([key, value]) => ({ key, value }))
    );
    setStateMapEntries(
      Object.entries(edge.stateMap || {})
        .map(([key, color]) => ({ key, color: (color === 'yellow' || color === 'red' ? color : 'green') as 'green' | 'yellow' | 'red' }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edge.id, isDynamic]);

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      <span>{sourceName} → {targetName}</span>
      <span className="topo-editor-card-badge">{edge.type}</span>
      <div className="topo-editor-card-actions">
        {onDuplicate && <IconButton name="copy" size="sm" onClick={onDuplicate} tooltip="Duplicate edge" />}
        <IconButton name="trash-alt" size="sm" onClick={onDelete} tooltip="Delete edge" />
      </div>
    </div>
  );

  return (
    <div className="topo-editor-card">
      <CollapsableSection label={header} isOpen={isOpen} onToggle={onToggle}>
        <div className="topo-editor-field">
          <label>Source</label>
          <Select
            options={nodeOptions}
            value={edge.sourceId}
            onChange={(v) => handleField('sourceId', v.value!)}
            placeholder="Select source node..."
          />
        </div>
        {!isDynamic && (
          <div className="topo-editor-field">
            <label>Target</label>
            <Select
              options={nodeOptions}
              value={edge.targetId || ''}
              onChange={(v) => handleField('targetId', v.value!)}
              placeholder="Select target node..."
            />
          </div>
        )}
        <div className="topo-editor-row">
          <Checkbox
            label="Use dynamic targets (discover from PromQL query)"
            value={isDynamic}
            onChange={(e) => toggleDynamicTargets(e.currentTarget.checked)}
          />
        </div>
        {isDynamic && (
          <div style={{ marginLeft: 4, paddingLeft: 8, borderLeft: '2px solid #2d3748' }}>
            <div className="topo-editor-field">
              <label>Discovery datasource</label>
              <DataSourcePicker
                current={edge.targetQuery?.datasourceUid || null}
                onChange={(ds) => handleTargetQueryField('datasourceUid', ds.uid)}
                noDefault
              />
            </div>

            {/* Prometheus: PromQL discovery query */}
            {(targetDsType === 'prometheus' || targetDsType === '') && (
              <div className="topo-editor-field">
                <label>
                  PromQL query
                  <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>returns one row per target</span>
                </label>
                <Input
                  value={edge.targetQuery?.query || ''}
                  onChange={(e) => handleTargetQueryField('query', e.currentTarget.value)}
                  placeholder={'up{job="myapp"}'}
                />
              </div>
            )}

            {/* CloudWatch: discover by parsing frame names for the dimension */}
            {targetDsType === 'cloudwatch' && (
              <>
                <div className="topo-editor-field">
                  <label>Namespace</label>
                  <Input
                    value={edge.targetQuery?.queryConfig?.namespace || ''}
                    onChange={(e) => updateTargetQueryConfig('namespace', e.currentTarget.value || undefined)}
                    placeholder="AWS/ApplicationELB"
                  />
                </div>
                <div className="topo-editor-field">
                  <label>Metric name</label>
                  <Input
                    value={edge.targetQuery?.queryConfig?.metricName || ''}
                    onChange={(e) => updateTargetQueryConfig('metricName', e.currentTarget.value || undefined)}
                    placeholder="RequestCount"
                  />
                </div>
                <div className="topo-editor-field">
                  <label>
                    Filter dimensions
                    <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>restrict the discovery (leave the discovery dimension out)</span>
                  </label>
                  {targetDimEntries.length === 0 && (
                    <div style={{ fontSize: 10, color: '#616e88', padding: '4px 0' }}>
                      No filters — discover all values of the Node ID label
                    </div>
                  )}
                  {targetDimEntries.map((entry, idx) => (
                    <div key={idx} className="topo-editor-row" style={{ gap: 4, marginBottom: 2 }}>
                      <Input
                        value={entry.key}
                        onChange={(e) => updateTargetDim(idx, 'key', e.currentTarget.value)}
                        placeholder="LoadBalancerType"
                        width={14}
                      />
                      <span style={{ color: '#616e88', fontSize: 11 }}>=</span>
                      <Input
                        value={entry.value}
                        onChange={(e) => updateTargetDim(idx, 'value', e.currentTarget.value)}
                        placeholder="application"
                        width={16}
                      />
                      <IconButton
                        name="trash-alt"
                        size="sm"
                        onClick={() => removeTargetDim(idx)}
                        tooltip="Remove filter"
                      />
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" icon="plus" onClick={addTargetDim} style={{ marginTop: 4 }}>
                    Add filter
                  </Button>
                </div>
              </>
            )}

            {/* Infinity: discover via JSON URL + column selector */}
            {targetDsType === 'yesoreyeram-infinity-datasource' && (
              <>
                <div className="topo-editor-field">
                  <label>URL</label>
                  <Input
                    value={edge.targetQuery?.queryConfig?.url || ''}
                    onChange={(e) => updateTargetQueryConfig('url', e.currentTarget.value || undefined)}
                    placeholder="https://api.example.com/members"
                  />
                </div>
                <div className="topo-editor-row">
                  <div className="topo-editor-field" style={{ flex: 1 }}>
                    <label>Method</label>
                    <Select
                      options={INFINITY_METHODS}
                      value={edge.targetQuery?.queryConfig?.method || 'GET'}
                      onChange={(v) => updateTargetQueryConfig('method', v.value || 'GET')}
                    />
                  </div>
                  <div className="topo-editor-field" style={{ flex: 2 }}>
                    <label>
                      Root selector
                      <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>JSON path to the array</span>
                    </label>
                    <Input
                      value={edge.targetQuery?.queryConfig?.rootSelector || ''}
                      onChange={(e) => updateTargetQueryConfig('rootSelector', e.currentTarget.value || undefined)}
                      placeholder="data.members"
                    />
                  </div>
                </div>
                {edge.targetQuery?.queryConfig?.method === 'POST' && (
                  <div className="topo-editor-field">
                    <label>Body <span style={{ fontSize: 9, color: '#4c566a' }}>raw JSON</span></label>
                    <TextArea
                      value={edge.targetQuery?.queryConfig?.body || ''}
                      onChange={(e) => updateTargetQueryConfig('body', e.currentTarget.value || undefined)}
                      placeholder='{"query": "..."}'
                      rows={3}
                    />
                  </div>
                )}
              </>
            )}

            <div className="topo-editor-field">
              <label>
                Node ID label
                <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>
                  {targetDsType === 'cloudwatch'
                    ? 'CloudWatch dimension to extract (e.g. LoadBalancer)'
                    : targetDsType === 'yesoreyeram-infinity-datasource'
                    ? 'JSON column selector (e.g. hostname)'
                    : 'label name whose value is the target node id'}
                </span>
              </label>
              <Input
                value={edge.targetQuery?.nodeIdLabel || ''}
                onChange={(e) => handleTargetQueryField('nodeIdLabel', e.currentTarget.value)}
                placeholder={targetDsType === 'cloudwatch' ? 'LoadBalancer' : 'instance'}
              />
            </div>
            <div style={{ fontSize: 9, color: '#616e88', padding: '4px 0 0' }}>
              Each discovered value must match an existing node id. Values with no matching
              node are skipped and logged to the console. (3.1b does not yet auto-create
              virtual nodes from a template.)
            </div>
          </div>
        )}
        <div className="topo-editor-field">
          <label>Type</label>
          <RadioButtonGroup options={EDGE_TYPES} value={edge.type} onChange={(v) => handleField('type', v)} size="sm" />
        </div>
        <div className="topo-editor-field">
          <label>Label template <span style={{ fontSize: 9, color: '#4c566a' }}>{'use ${value} for metric interpolation'}</span></label>
          <Input
            value={edge.labelTemplate || ''}
            onChange={(e) => handleField('labelTemplate', e.currentTarget.value || undefined)}
            placeholder="${value} rps"
          />
        </div>
        <div className="topo-editor-field">
          <label>Latency label <span style={{ fontSize: 9, color: '#4c566a' }}>secondary text shown under the main label</span></label>
          <Input
            value={edge.latencyLabel || ''}
            onChange={(e) => handleField('latencyLabel', e.currentTarget.value || undefined)}
            placeholder="p95: 12ms"
          />
        </div>
        <div className="topo-editor-row">
          <Checkbox
            label="Bidirectional"
            value={edge.bidirectional}
            onChange={(e) => handleField('bidirectional', e.currentTarget.checked)}
          />
        </div>
        <div className="topo-editor-field">
          <label>Notes</label>
          <TextArea
            value={edge.description || ''}
            onChange={(e) => handleField('description', e.currentTarget.value || undefined)}
            placeholder="Annotations..."
            rows={2}
          />
        </div>

        {/* Metric — with datasource picker */}
        <CollapsableSection label="Metric" isOpen={showMetric} onToggle={() => setShowMetric(!showMetric)}>
          <div className="topo-editor-field">
            <label>Datasource</label>
            <DataSourcePicker
              current={edge.metric?.datasourceUid || null}
              onChange={(ds) => handleMetricField('datasourceUid', ds.uid)}
              noDefault
            />
          </div>

          {/* Prometheus: free-text PromQL */}
          {edge.metric?.datasourceUid && (dsType === 'prometheus' || dsType === '') && (
            <div className="topo-editor-field">
              <label>Query <span style={{ fontSize: 9, color: '#4c566a' }}>PromQL</span></label>
              <Input
                value={edge.metric?.query || ''}
                onChange={(e) => handleMetricField('query', e.currentTarget.value)}
                placeholder="sum(rate(...))"
              />
            </div>
          )}

          {/* Alias — always shown (used as a fallback matcher to panel data frames) */}
          <div className="topo-editor-field">
            <label>Alias</label>
            <Input
              value={edge.metric?.alias || ''}
              onChange={(e) => handleMetricField('alias', e.currentTarget.value)}
              placeholder="traffic"
            />
          </div>

          {/* CloudWatch */}
          {edge.metric?.datasourceUid && dsType === 'cloudwatch' && (
            <>
              <div className="topo-editor-section-title">CloudWatch query</div>
              <div className="topo-editor-field">
                <label>Namespace</label>
                <Input
                  value={edge.metric?.queryConfig?.namespace || ''}
                  onChange={(e) => updateMetricQueryConfig('namespace', e.currentTarget.value || undefined)}
                  placeholder="AWS/ApplicationELB"
                />
              </div>
              <div className="topo-editor-field">
                <label>Metric name</label>
                <Input
                  value={edge.metric?.queryConfig?.metricName || ''}
                  onChange={(e) => updateMetricQueryConfig('metricName', e.currentTarget.value || undefined)}
                  placeholder="RequestCount"
                />
              </div>
              <div className="topo-editor-field">
                <label>
                  Dimensions
                  <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>key=value pairs</span>
                </label>
                {dimEntries.length === 0 && (
                  <div style={{ fontSize: 10, color: '#616e88', padding: '4px 0' }}>
                    No dimensions — add at least one if the CloudWatch metric requires them
                  </div>
                )}
                {dimEntries.map((entry, idx) => (
                  <div key={idx} className="topo-editor-row" style={{ gap: 4, marginBottom: 2 }}>
                    <Input
                      value={entry.key}
                      onChange={(e) => updateDim(idx, 'key', e.currentTarget.value)}
                      placeholder="LoadBalancer"
                      width={14}
                    />
                    <span style={{ color: '#616e88', fontSize: 11 }}>=</span>
                    <Input
                      value={entry.value}
                      onChange={(e) => updateDim(idx, 'value', e.currentTarget.value)}
                      placeholder="app/my-alb/abc123"
                      width={18}
                    />
                    <IconButton
                      name="trash-alt"
                      size="sm"
                      onClick={() => removeDim(idx)}
                      tooltip="Remove dimension"
                    />
                  </div>
                ))}
                <Button size="sm" variant="secondary" icon="plus" onClick={addDim} style={{ marginTop: 4 }}>
                  Add dimension
                </Button>
              </div>
              <div className="topo-editor-row">
                <div className="topo-editor-field" style={{ flex: 1 }}>
                  <label>Stat</label>
                  <Select
                    options={CLOUDWATCH_STATS}
                    value={edge.metric?.queryConfig?.stat || 'Average'}
                    onChange={(v) => updateMetricQueryConfig('stat', v.value || 'Average')}
                  />
                </div>
                <div className="topo-editor-field" style={{ flex: 1 }}>
                  <label>Period (s)</label>
                  <Input
                    type="number"
                    value={edge.metric?.queryConfig?.period || 300}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      updateMetricQueryConfig('period', Number.isFinite(n) && n > 0 ? n : undefined);
                    }}
                    placeholder="300"
                  />
                </div>
              </div>
            </>
          )}

          {/* Infinity */}
          {edge.metric?.datasourceUid && dsType === 'yesoreyeram-infinity-datasource' && (
            <>
              <div className="topo-editor-section-title">Infinity query</div>
              <div className="topo-editor-field">
                <label>URL</label>
                <Input
                  value={edge.metric?.queryConfig?.url || ''}
                  onChange={(e) => updateMetricQueryConfig('url', e.currentTarget.value || undefined)}
                  placeholder="https://api.example.com/data"
                />
              </div>
              <div className="topo-editor-row">
                <div className="topo-editor-field" style={{ flex: 1 }}>
                  <label>Method</label>
                  <Select
                    options={INFINITY_METHODS}
                    value={edge.metric?.queryConfig?.method || 'GET'}
                    onChange={(v) => updateMetricQueryConfig('method', v.value || 'GET')}
                  />
                </div>
                <div className="topo-editor-field" style={{ flex: 2 }}>
                  <label>
                    Root selector
                    <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>JSON path</span>
                  </label>
                  <Input
                    value={edge.metric?.queryConfig?.rootSelector || ''}
                    onChange={(e) => updateMetricQueryConfig('rootSelector', e.currentTarget.value || undefined)}
                    placeholder="data.result"
                  />
                </div>
              </div>
              {edge.metric?.queryConfig?.method === 'POST' && (
                <div className="topo-editor-field">
                  <label>Body <span style={{ fontSize: 9, color: '#4c566a' }}>raw JSON</span></label>
                  <TextArea
                    value={edge.metric?.queryConfig?.body || ''}
                    onChange={(e) => updateMetricQueryConfig('body', e.currentTarget.value || undefined)}
                    placeholder='{"query": "..."}'
                    rows={3}
                  />
                </div>
              )}
            </>
          )}
        </CollapsableSection>

        {/* Thresholds */}
        <CollapsableSection
          label={`Thresholds (${(edge.thresholds || []).length})`}
          isOpen={showThresholds}
          onToggle={() => setShowThresholds(!showThresholds)}
        >
          <ThresholdList thresholds={edge.thresholds || []} onChange={(t) => handleField('thresholds', t)} />
        </CollapsableSection>

        {/* State map — categorical coloring (e.g. HA sync 0/1 → red/green) */}
        <CollapsableSection
          label={`State map (${stateMapEntries.length})`}
          isOpen={showStateMap}
          onToggle={() => setShowStateMap(!showStateMap)}
        >
          <div style={{ fontSize: 10, color: '#616e88', padding: '4px 0' }}>
            Override threshold coloring for categorical metrics. Keys are compared as strings
            against the metric value (e.g. a Prometheus query returning 1 matches key &quot;1&quot;).
            When set, stateMap takes precedence over thresholds for matching values.
          </div>
          {stateMapEntries.length === 0 && (
            <div style={{ fontSize: 10, color: '#616e88', padding: '4px 0' }}>
              No state map entries — thresholds drive edge color
            </div>
          )}
          {stateMapEntries.map((entry, idx) => (
            <div key={idx} className="topo-editor-row" style={{ gap: 4, marginBottom: 2 }}>
              <Input
                value={entry.key}
                onChange={(e) => updateStateMapKey(idx, e.currentTarget.value)}
                placeholder="1"
                width={12}
              />
              <span style={{ color: '#616e88', fontSize: 11 }}>=</span>
              <Select
                options={STATE_MAP_COLORS}
                value={entry.color}
                onChange={(v) => updateStateMapColor(idx, (v.value as 'green' | 'yellow' | 'red') || 'green')}
                width={14}
              />
              <IconButton
                name="trash-alt"
                size="sm"
                onClick={() => removeStateMap(idx)}
                tooltip="Remove mapping"
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={addStateMap}
            style={{ marginTop: 4 }}
          >
            Add mapping
          </Button>
        </CollapsableSection>

        {/* Visual config */}
        <CollapsableSection label="Visual" isOpen={showVisual} onToggle={() => setShowVisual(!showVisual)}>
          <div className="topo-editor-field">
            <label>Thickness mode</label>
            <RadioButtonGroup options={THICKNESS_MODES} value={edge.thicknessMode} onChange={(v) => handleField('thicknessMode', v)} size="sm" />
          </div>
          <div className="topo-editor-row">
            <div className="topo-editor-field" style={{ flex: 1 }}>
              <label>Min (px)</label>
              <Input
                type="number"
                value={edge.thicknessMin}
                onChange={(e) => handleField('thicknessMin', parseFloat(e.currentTarget.value) || 1)}
                width={8}
              />
            </div>
            <div className="topo-editor-field" style={{ flex: 1 }}>
              <label>Max (px)</label>
              <Input
                type="number"
                value={edge.thicknessMax}
                onChange={(e) => handleField('thicknessMax', parseFloat(e.currentTarget.value) || 4)}
                width={8}
              />
            </div>
          </div>
          <div className="topo-editor-row">
            <Checkbox
              label="Flow animation"
              value={edge.flowAnimation}
              onChange={(e) => handleField('flowAnimation', e.currentTarget.checked)}
            />
          </div>
          <div className="topo-editor-field">
            <label>Speed</label>
            <Select
              options={FLOW_SPEEDS}
              value={edge.flowSpeed || ''}
              onChange={(v) => {
                const next = v.value;
                handleField('flowSpeed', next ? (next as FlowSpeed) : undefined);
              }}
            />
          </div>
          <div className="topo-editor-row">
            <div className="topo-editor-field" style={{ flex: 1 }}>
              <label>Anchor src</label>
              <Select options={ANCHORS} value={edge.anchorSource} onChange={(v) => handleField('anchorSource', v.value!)} />
            </div>
            <div className="topo-editor-field" style={{ flex: 1 }}>
              <label>Anchor tgt</label>
              <Select options={ANCHORS} value={edge.anchorTarget} onChange={(v) => handleField('anchorTarget', v.value!)} />
            </div>
          </div>
        </CollapsableSection>
      </CollapsableSection>
    </div>
  );
};
