import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { CollapsableSection, Input, Select, Checkbox, IconButton, Button, TextArea } from '@grafana/ui';
import { DataSourcePicker, getDataSourceSrv } from '@grafana/runtime';
import { TopologyNode, NodeMetricConfig, NodeGroup, ObservabilityLink, NODE_TYPE_CONFIG, ACCENT_COLOR } from '../../types';
import { MetricEditor } from './MetricEditor';
import { getNodeTypeOptions, findNodeGroup, generateId, sanitizeLabel } from '../utils/editorUtils';
import { NodeEditSection } from '../../utils/panelEvents';
import '../editors.css';

interface Props {
  node: TopologyNode;
  groups: NodeGroup[];
  isOpen: boolean;
  onToggle: () => void;
  onChange: (updated: TopologyNode) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  /**
   * When set, programmatically expands the matching sub-section of the
   * card (Metrics, Advanced) the next time the card becomes open. Used
   * by right-click context-menu section redirects.
   */
  sectionHint?: NodeEditSection;
}

// ─── Hook: discover jobs and instances from a Prometheus datasource ───
function useHostDiscovery(datasourceUid: string) {
  const [jobs, setJobs] = useState<Array<{ label: string; value: string }>>([]);
  const [instances, setInstances] = useState<Array<{ label: string; value: string }>>([]);
  const [selectedJob, setSelectedJob] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!datasourceUid) { setJobs([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const ds = await getDataSourceSrv().get(datasourceUid);
        if (cancelled || ds.type !== 'prometheus') { setLoading(false); return; }
        const resp = await fetch(`/api/datasources/proxy/uid/${datasourceUid}/api/v1/query?query=${encodeURIComponent('count by(job)(up)')}`);
        if (cancelled) { return; }
        const data = await resp.json();
        const list: string[] = (data?.data?.result || []).map((r: { metric: { job: string } }) => r.metric.job).sort();
        setJobs(list.map((j) => ({ label: j, value: j })));
      } catch { /* ignore */ }
      finally { if (!cancelled) { setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [datasourceUid]);

  useEffect(() => {
    if (!datasourceUid || !selectedJob) { setInstances([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/datasources/proxy/uid/${datasourceUid}/api/v1/query?query=${encodeURIComponent(`up{job="${sanitizeLabel(selectedJob)}"}`)}`);
        if (cancelled) { return; }
        const data = await resp.json();
        const hosts: Array<{ instance: string; up: string }> = (data?.data?.result || []).map(
          (r: { metric: { instance: string }; value: [number, string] }) => ({ instance: r.metric.instance, up: r.value[1] })
        );
        setInstances(hosts.filter((h) => h.instance).map((h) => ({
          label: `${h.instance}${h.up === '0' ? ' (down)' : ''}`,
          value: h.instance,
        })));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [datasourceUid, selectedJob]);

  return { jobs, instances, selectedJob, setSelectedJob, loading };
}

// ─── Hook: discover available metric names for a host ───
function useMetricDiscovery(datasourceUid: string, job: string, instance: string) {
  const [metrics, setMetrics] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!datasourceUid || !instance) { setMetrics([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const query = job
          ? `{job="${sanitizeLabel(job)}", instance="${sanitizeLabel(instance)}"}`
          : `{instance="${sanitizeLabel(instance)}"}`;
        const resp = await fetch(
          `/api/datasources/proxy/uid/${datasourceUid}/api/v1/series?` +
          new URLSearchParams({
            'match[]': query,
            start: String(Math.floor(Date.now() / 1000) - 300),
            end: String(Math.floor(Date.now() / 1000)),
          })
        );
        if (cancelled) { return; }
        const data = await resp.json();
        const names = [...new Set((data?.data || []).map((s: Record<string, string>) => s.__name__))].filter(Boolean).sort() as string[];
        setMetrics(names);
      } catch { /* ignore */ }
      finally { if (!cancelled) { setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [datasourceUid, job, instance]);

  return { metrics, loading };
}

export const NodeCard: React.FC<Props> = ({ node, groups, isOpen, onToggle, onChange, onDelete, onDuplicate, sectionHint }) => {
  // ─── State ───
  const [expandedMetrics, setExpandedMetrics] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);

  // Open the matching sub-section when a section-targeted edit request
  // arrives via NodesEditor (sectionHint prop). Only acts when the card
  // is already open. 'metrics' → Metrics section; 'advanced' /
  // 'alertMatchers' / 'observabilityLinks' all map to the Advanced section
  // (alert matchers and observability links both live inside Advanced).
  useEffect(() => {
    if (!isOpen || !sectionHint) { return; }
    if (sectionHint === 'metrics') {
      setShowMetrics(true);
    } else if (sectionHint === 'advanced' || sectionHint === 'alertMatchers' || sectionHint === 'observabilityLinks') {
      setShowAdvanced(true);
    }
  }, [isOpen, sectionHint]);

  // ─── Discovery state (for new/empty nodes) ───
  const [dsUid, setDsUid] = useState('');
  const [selectedInstance, setSelectedInstance] = useState('');
  const [selectedMetricNames, setSelectedMetricNames] = useState<Set<string>>(new Set());

  const { jobs, instances, selectedJob, setSelectedJob, loading: jobsLoading } = useHostDiscovery(dsUid);
  const { metrics: availableMetrics, loading: metricsLoading } = useMetricDiscovery(dsUid, selectedJob, selectedInstance);

  // ─── Derived ───
  const isNew = node.metrics.length === 0 && node.name === 'New node';
  const typeOptions = useMemo(() => getNodeTypeOptions(), []);
  const typeConfig = NODE_TYPE_CONFIG[node.type];
  const memberOfGroup = useMemo(() => findNodeGroup(node.id, groups), [node.id, groups]);
  const summaryCount = useMemo(() => node.metrics.filter((m) => m.isSummary).length, [node.metrics]);

  const handleField = useCallback(
    <K extends keyof TopologyNode>(field: K, value: TopologyNode[K]) => {
      onChange({ ...node, [field]: value });
    },
    [node, onChange]
  );

  // ─── Alert label matchers (local state so half-typed keys don't lose focus) ───
  const [matcherEntries, setMatcherEntries] = useState<Array<{ key: string; value: string }>>(
    () => Object.entries(node.alertLabelMatchers || {}).map(([key, value]) => ({ key, value }))
  );

  const syncMatchers = useCallback((next: Array<{ key: string; value: string }>) => {
    setMatcherEntries(next);
    const obj: Record<string, string> = {};
    next.forEach(({ key, value }) => {
      if (key) { obj[key] = value; }
    });
    handleField('alertLabelMatchers', Object.keys(obj).length > 0 ? obj : undefined);
  }, [handleField]);

  const addMatcher = useCallback(() => {
    syncMatchers([...matcherEntries, { key: '', value: '' }]);
  }, [matcherEntries, syncMatchers]);

  const updateMatcher = useCallback((idx: number, field: 'key' | 'value', val: string) => {
    syncMatchers(matcherEntries.map((m, i) => (i === idx ? { ...m, [field]: val } : m)));
  }, [matcherEntries, syncMatchers]);

  const removeMatcher = useCallback((idx: number) => {
    syncMatchers(matcherEntries.filter((_, i) => i !== idx));
  }, [matcherEntries, syncMatchers]);

  // ─── Observability links (same local-state pattern as Alert matchers) ───
  const [linkEntries, setLinkEntries] = useState<Array<{ label: string; url: string; icon: string }>>(
    () => (node.observabilityLinks || []).map((l) => ({ label: l.label, url: l.url, icon: l.icon || '' }))
  );

  const syncLinks = useCallback((next: Array<{ label: string; url: string; icon: string }>) => {
    setLinkEntries(next);
    const links: ObservabilityLink[] = next
      .filter((e) => e.label && e.url)
      .map((e) => ({ label: e.label, url: e.url, ...(e.icon ? { icon: e.icon } : {}) }));
    handleField('observabilityLinks', links.length > 0 ? links : undefined);
  }, [handleField]);

  // Resync the matcher/link mirrors whenever the underlying node identity
  // swaps. Without this, a parent re-render that hands this card a different
  // node (e.g. filter search reusing the component instance) would leave
  // stale matchers/links visible while handleField writes to the new node —
  // a silent data-loss path. We deliberately depend ONLY on node.id, not on
  // alertLabelMatchers/observabilityLinks themselves, because those fields
  // are written via handleField on every edit and listing them here would
  // overwrite the user's in-flight edit on the next render tick.
  useEffect(() => {
    setMatcherEntries(
      Object.entries(node.alertLabelMatchers || {}).map(([key, value]) => ({ key, value }))
    );
    setLinkEntries(
      (node.observabilityLinks || []).map((l) => ({ label: l.label, url: l.url, icon: l.icon || '' }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const addLink = useCallback(() => {
    syncLinks([...linkEntries, { label: '', url: '', icon: '' }]);
  }, [linkEntries, syncLinks]);

  const updateLink = useCallback((idx: number, field: 'label' | 'url' | 'icon', val: string) => {
    syncLinks(linkEntries.map((l, i) => (i === idx ? { ...l, [field]: val } : l)));
  }, [linkEntries, syncLinks]);

  const removeLink = useCallback((idx: number) => {
    syncLinks(linkEntries.filter((_, i) => i !== idx));
  }, [linkEntries, syncLinks]);

  // ─── When user selects a host, auto-fill name ───
  const handleHostSelect = useCallback((instance: string) => {
    setSelectedInstance(instance);
    onChange({ ...node, name: instance });
  }, [node, onChange]);

  // ─── Toggle metric in selection set ───
  const toggleMetricSelection = useCallback((name: string) => {
    setSelectedMetricNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  }, []);

  // ─── Apply selected metrics to node ───
  const handleApplyMetrics = useCallback(() => {
    const newMetrics: NodeMetricConfig[] = [...selectedMetricNames].map((name, idx) => ({
      id: generateId('m'),
      label: name.replace(/^(windows_|cloudflare_|node_|kube_|container_)/, '').replace(/_total$/, '').substring(0, 20),
      datasourceUid: dsUid,
      query: name,
      format: '${value}',
      section: 'General',
      isSummary: idx < 4, // first 4 are summary
      thresholds: [{ value: 0, color: 'green' as const }],
      showSparkline: false,
    }));
    onChange({ ...node, metrics: [...node.metrics, ...newMetrics] });
    setSelectedMetricNames(new Set());
    setShowMetrics(true);
  }, [selectedMetricNames, dsUid, node, onChange]);

  // ─── Existing metric CRUD ───
  const handleMetricChange = useCallback(
    (updated: NodeMetricConfig) => {
      onChange({ ...node, metrics: node.metrics.map((m) => (m.id === updated.id ? updated : m)) });
    },
    [node, onChange]
  );

  const handleMetricDelete = useCallback(
    (id: string) => {
      onChange({ ...node, metrics: node.metrics.filter((m) => m.id !== id) });
    },
    [node, onChange]
  );

  const handleMetricAdd = useCallback(() => {
    const newMetric: NodeMetricConfig = {
      id: generateId('m'),
      label: 'metric',
      datasourceUid: dsUid || '',
      query: '',
      format: '${value}',
      section: 'General',
      isSummary: false,
      thresholds: [{ value: 0, color: 'green' }],
      showSparkline: false,
    };
    onChange({ ...node, metrics: [...node.metrics, newMetric] });
    setExpandedMetrics((prev) => new Set(prev).add(newMetric.id));
    setShowMetrics(true);
  }, [node, onChange, dsUid]);

  const toggleMetric = useCallback((id: string) => {
    setExpandedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  // ─── Header ───
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      <span className="topo-editor-card-badge" style={{ background: typeConfig.color + '22', color: typeConfig.color }}>
        {typeConfig.icon}
      </span>
      <span>{node.name || 'Untitled'}</span>
      {node.metrics.length > 0 && (
        <span style={{ fontSize: 9, color: '#616e88', marginLeft: 4 }}>
          {node.metrics.length}m{summaryCount > 0 ? ` (${summaryCount}S)` : ''}
        </span>
      )}
      <div className="topo-editor-card-actions">
        {onDuplicate && <IconButton name="copy" size="sm" onClick={onDuplicate} tooltip="Duplicate node" />}
        <IconButton name="trash-alt" size="sm" onClick={onDelete} tooltip="Delete node" />
      </div>
    </div>
  );

  return (
    <div className="topo-editor-card">
      <CollapsableSection label={header} isOpen={isOpen} onToggle={onToggle}>

        {/* ═══════════ STEP 1: Datasource ═══════════ */}
        <div className="topo-editor-section-title">1. Datasource</div>
        <div className="topo-editor-field">
          <DataSourcePicker
            current={dsUid || null}
            onChange={(ds) => {
              setDsUid(ds.uid);
              setSelectedJob('');
              setSelectedInstance('');
              // Drop the metric name selection too — otherwise names from
              // the old datasource silently carry into the new node when
              // the user clicks "Add metrics" on the new DS.
              setSelectedMetricNames(new Set());
            }}
            noDefault
          />
        </div>

        {/* ═══════════ STEP 2: Host / Instance ═══════════ */}
        {dsUid && (
          <>
            <div className="topo-editor-section-title">2. Host / Instance</div>
            <div className="topo-editor-field">
              <label>Job / Service</label>
              <Select
                options={jobs}
                value={selectedJob || null}
                onChange={(v) => { setSelectedJob(v.value!); setSelectedInstance(''); }}
                placeholder="Select job..."
                isLoading={jobsLoading}
              />
            </div>
            {selectedJob && (
              <div className="topo-editor-field">
                <label>Instance ({instances.length} available)</label>
                <Select
                  options={instances}
                  value={selectedInstance || null}
                  onChange={(v) => handleHostSelect(v.value!)}
                  placeholder="Select host..."
                />
              </div>
            )}
          </>
        )}

        {/* ═══════════ STEP 3: Select metrics (for new nodes or adding more) ═══════════ */}
        {selectedInstance && availableMetrics.length > 0 && (
          <>
            <div className="topo-editor-section-title">
              3. Select metrics ({availableMetrics.length} available)
              <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>first 4 = summary</span>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #2d3748', borderRadius: 4, padding: 4 }}>
              {availableMetrics.map((name) => (
                <div
                  key={name}
                  className="topo-editor-row"
                  style={{ padding: '1px 2px', cursor: 'pointer' }}
                  onClick={() => toggleMetricSelection(name)}
                >
                  <Checkbox value={selectedMetricNames.has(name)} onChange={() => toggleMetricSelection(name)} />
                  <span style={{ fontSize: 10, color: selectedMetricNames.has(name) ? '#88c0d0' : '#616e88' }}>
                    {name}
                  </span>
                </div>
              ))}
            </div>
            {selectedMetricNames.size > 0 && (
              <Button
                size="sm"
                variant="primary"
                onClick={handleApplyMetrics}
                style={{ marginTop: 6, width: '100%' }}
              >
                Add {selectedMetricNames.size} metrics (first {Math.min(4, selectedMetricNames.size)} as summary)
              </Button>
            )}
          </>
        )}
        {selectedInstance && metricsLoading && (
          <div className="topo-editor-empty">Discovering metrics...</div>
        )}

        {/* ═══════════ STEP 4: Name, Type, Label, Annotation ═══════════ */}
        {(node.name !== 'New node' || node.metrics.length > 0 || selectedInstance) && (
          <>
            <div className="topo-editor-section-title">4. Identity</div>
            <div className="topo-editor-field">
              <label>Name</label>
              <Input value={node.name} onChange={(e) => handleField('name', e.currentTarget.value)} placeholder="Node name" />
            </div>
            <div className="topo-editor-field">
              <label>Type</label>
              <Select options={typeOptions} value={node.type} onChange={(v) => handleField('type', v.value!)} />
            </div>
            <div className="topo-editor-field">
              <label>Role</label>
              <Input value={node.role} onChange={(e) => handleField('role', e.currentTarget.value)} placeholder="active, standby, CDN / WAF..." />
            </div>
            <div className="topo-editor-field">
              <label>Notes / Annotation</label>
              <TextArea
                value={node.description || ''}
                onChange={(e) => handleField('description', e.currentTarget.value || undefined)}
                placeholder="Owner, runbook link, purpose..."
                rows={2}
              />
            </div>
          </>
        )}

        {memberOfGroup && (
          <div style={{ fontSize: 10, color: ACCENT_COLOR, padding: '4px 0' }}>
            Group: {memberOfGroup.label}
          </div>
        )}

        {/* ═══════════ Advanced (existing nodes) ═══════════ */}
        {!isNew && (
          <CollapsableSection label="Advanced" isOpen={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
            <div className="topo-editor-row">
              <Checkbox label="Compact" value={node.compact} onChange={(e) => handleField('compact', e.currentTarget.checked)} />
            </div>
            <div className="topo-editor-field">
              <label>Icon override <span style={{ fontSize: 9, color: '#4c566a' }}>2-3 chars, replaces type icon</span></label>
              <Input
                value={node.iconOverride || ''}
                onChange={(e) => handleField('iconOverride', e.currentTarget.value || undefined)}
                placeholder="SB, GA, API..."
                width={10}
              />
            </div>
            <div className="topo-editor-field">
              <label>Width (px)</label>
              <Input
                type="number"
                value={node.width || ''}
                onChange={(e) => handleField('width', parseInt(e.currentTarget.value, 10) || undefined)}
                placeholder="auto"
                width={12}
              />
            </div>
            <div className="topo-editor-field">
              <label>Position</label>
              <div className="topo-editor-row">
                <Input
                  type="number"
                  value={node.position.x}
                  onChange={(e) => handleField('position', { ...node.position, x: parseInt(e.currentTarget.value, 10) || 0 })}
                  prefix="X"
                  width={10}
                />
                <Input
                  type="number"
                  value={node.position.y}
                  onChange={(e) => handleField('position', { ...node.position, y: parseInt(e.currentTarget.value, 10) || 0 })}
                  prefix="Y"
                  width={10}
                />
              </div>
            </div>
            <div className="topo-editor-field">
              <label>
                Alert matchers
                <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>
                  match Grafana alerts by labels (ALL must match)
                </span>
              </label>
              {matcherEntries.length === 0 && (
                <div style={{ fontSize: 10, color: '#616e88', padding: '4px 0' }}>
                  No matchers — alert integration disabled for this node
                </div>
              )}
              {matcherEntries.map((entry, idx) => (
                <div key={idx} className="topo-editor-row" style={{ gap: 4, marginBottom: 2 }}>
                  <Input
                    value={entry.key}
                    onChange={(e) => updateMatcher(idx, 'key', e.currentTarget.value)}
                    placeholder="label (e.g. instance)"
                    width={14}
                  />
                  <span style={{ color: '#616e88', fontSize: 11 }}>=</span>
                  <Input
                    value={entry.value}
                    onChange={(e) => updateMatcher(idx, 'value', e.currentTarget.value)}
                    placeholder="value"
                    width={16}
                  />
                  <IconButton
                    name="trash-alt"
                    size="sm"
                    onClick={() => removeMatcher(idx)}
                    tooltip="Remove matcher"
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={addMatcher}
                style={{ marginTop: 4 }}
              >
                Add matcher
              </Button>
            </div>
            <div className="topo-editor-field">
              <label>
                Observability links
                <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>
                  drill-down buttons in node popup; URLs support {'${tokens}'} from labels/name/id
                </span>
              </label>
              {linkEntries.length === 0 && (
                <div style={{ fontSize: 10, color: '#616e88', padding: '4px 0' }}>
                  No links — node has no drill-down buttons
                </div>
              )}
              {linkEntries.map((entry, idx) => (
                <div key={idx} style={{ marginBottom: 4 }}>
                  <div className="topo-editor-row" style={{ gap: 4 }}>
                    <Input
                      value={entry.label}
                      onChange={(e) => updateLink(idx, 'label', e.currentTarget.value)}
                      placeholder="Logs"
                      width={12}
                    />
                    <Input
                      value={entry.icon}
                      onChange={(e) => updateLink(idx, 'icon', e.currentTarget.value)}
                      placeholder="icon (optional)"
                      width={14}
                    />
                    <IconButton
                      name="trash-alt"
                      size="sm"
                      onClick={() => removeLink(idx)}
                      tooltip="Remove link"
                    />
                  </div>
                  <Input
                    value={entry.url}
                    onChange={(e) => updateLink(idx, 'url', e.currentTarget.value)}
                    placeholder="https://... or /explore?left=..."
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={addLink}
                style={{ marginTop: 4 }}
              >
                Add link
              </Button>
            </div>
          </CollapsableSection>
        )}

        {/* ═══════════ Configured metrics (existing nodes) ═══════════ */}
        {node.metrics.length > 0 && (
          <CollapsableSection
            label={`Configured metrics (${node.metrics.length}) — ${summaryCount} summary`}
            isOpen={showMetrics}
            onToggle={() => setShowMetrics(!showMetrics)}
          >
            {node.metrics.map((metric) => (
              <MetricEditor
                key={metric.id}
                metric={metric}
                isOpen={expandedMetrics.has(metric.id)}
                onToggle={() => toggleMetric(metric.id)}
                onChange={handleMetricChange}
                onDelete={() => handleMetricDelete(metric.id)}
              />
            ))}
            <Button size="sm" variant="secondary" icon="plus" onClick={handleMetricAdd} style={{ marginTop: 4 }}>
              Add metric manually
            </Button>
          </CollapsableSection>
        )}
      </CollapsableSection>
    </div>
  );
};
