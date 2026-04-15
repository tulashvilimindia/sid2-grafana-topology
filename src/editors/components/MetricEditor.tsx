import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { CollapsableSection, Input, Checkbox, IconButton, Select, Button, TextArea } from '@grafana/ui';
import { DataSourcePicker, getDataSourceSrv } from '@grafana/runtime';
import { NodeMetricConfig, DatasourceQueryConfig } from '../../types';
import { ThresholdList } from './ThresholdList';
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

interface Props {
  metric: NodeMetricConfig;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (updated: NodeMetricConfig) => void;
  onDelete: () => void;
}

export const MetricEditor: React.FC<Props> = ({ metric, isOpen, onToggle, onChange, onDelete }) => {
  const [availableMetrics, setAvailableMetrics] = useState<Array<{ label: string; value: string }>>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [dsType, setDsType] = useState<string>('');

  const handleField = useCallback(
    <K extends keyof NodeMetricConfig>(field: K, value: NodeMetricConfig[K]) => {
      onChange({ ...metric, [field]: value });
    },
    [metric, onChange]
  );

  // Patch a single queryConfig field and clean up empty objects
  const updateQueryConfig = useCallback(
    <K extends keyof DatasourceQueryConfig>(field: K, value: DatasourceQueryConfig[K]) => {
      const next: DatasourceQueryConfig = { ...(metric.queryConfig || {}) };
      if (value === undefined || value === '') {
        delete next[field];
      } else {
        next[field] = value;
      }
      handleField('queryConfig', Object.keys(next).length > 0 ? next : undefined);
    },
    [metric.queryConfig, handleField]
  );

  // ─── CloudWatch dimensions: local state for key/value list editor focus stability ───
  const [dimEntries, setDimEntries] = useState<Array<{ key: string; value: string }>>(
    () => Object.entries(metric.queryConfig?.dimensions || {}).map(([key, value]) => ({ key, value }))
  );

  const syncDimensions = useCallback(
    (next: Array<{ key: string; value: string }>) => {
      setDimEntries(next);
      const obj: Record<string, string> = {};
      next.forEach(({ key, value }) => {
        if (key) { obj[key] = value; }
      });
      updateQueryConfig('dimensions', Object.keys(obj).length > 0 ? obj : undefined);
    },
    [updateQueryConfig]
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

  // When datasource changes, capture its type and discover Prometheus metric names if applicable
  useEffect(() => {
    if (!metric.datasourceUid) {
      setAvailableMetrics([]);
      setDsType('');
      return;
    }

    let cancelled = false;
    setLoadingMetrics(true);

    const fetchMetrics = async () => {
      try {
        const ds = await getDataSourceSrv().get(metric.datasourceUid);
        if (cancelled) {return;}
        setDsType(ds.type);

        if (ds.type === 'prometheus') {
          // Query Prometheus label values for __name__
          const response = await fetch(
            `/api/datasources/proxy/uid/${metric.datasourceUid}/api/v1/label/__name__/values`
          );
          if (cancelled) {return;}
          const data = await response.json();
          const names: string[] = data?.data || [];
          setAvailableMetrics(names.map((n) => ({ label: n, value: n })));
        } else {
          // Reset stale Prometheus metric names when switching to a non-Prometheus DS
          setAvailableMetrics([]);
        }
      } catch {
        // Silently fail — user can still type manually
      } finally {
        if (!cancelled) {
          setLoadingMetrics(false);
        }
      }
    };

    fetchMetrics();
    return () => { cancelled = true; };
  }, [metric.datasourceUid]);

  // Existing sections used by sibling metrics (for Section dropdown)
  const sectionOptions = useMemo(() => {
    const common = ['System', 'Traffic', 'Performance', 'Security', 'Network', 'Application', 'Pool', 'Monitor', 'Health', 'Connections', 'Throughput', 'General'];
    return common.map((s) => ({ label: s, value: s }));
  }, []);

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      <span>{metric.label || 'metric'}</span>
      {metric.isSummary && <span className="topo-metric-badge">S</span>}
      <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>({metric.id})</span>
      <div className="topo-editor-card-actions">
        <IconButton name="trash-alt" size="sm" onClick={onDelete} tooltip="Remove metric" />
      </div>
    </div>
  );

  return (
    <CollapsableSection label={header} isOpen={isOpen} onToggle={onToggle}>
      <div className="topo-editor-field">
        <label>Metric ID <span style={{ fontSize: 9, color: '#4c566a' }}>internal stable key (auto-generated)</span></label>
        <Input value={metric.id} onChange={(e) => handleField('id', e.currentTarget.value)} placeholder="cf-rps" />
      </div>
      <div className="topo-editor-field">
        <label>
          Panel query refId
          <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>
            match a Grafana panel query by its refId (leave blank to fall back to Metric ID)
          </span>
        </label>
        <Input
          value={metric.refId || ''}
          onChange={(e) => handleField('refId', e.currentTarget.value || undefined)}
          placeholder="A"
          width={10}
        />
      </div>
      <div className="topo-editor-field">
        <label>Label</label>
        <Input value={metric.label} onChange={(e) => handleField('label', e.currentTarget.value)} placeholder="cpu, rps..." />
      </div>
      <div className="topo-editor-field">
        <label>Format <span style={{ fontSize: 9, color: '#4c566a' }}>use {'${value}'} for interpolation</span></label>
        <Input value={metric.format} onChange={(e) => handleField('format', e.currentTarget.value)} placeholder="${value}%" />
      </div>
      <div className="topo-editor-field">
        <label>Section <span style={{ fontSize: 9, color: '#4c566a' }}>groups metrics in expanded view</span></label>
        <Select
          options={sectionOptions}
          value={metric.section}
          onChange={(v) => handleField('section', v.value!)}
          allowCustomValue
          placeholder="Select or type..."
        />
      </div>
      <div className="topo-editor-row">
        <Checkbox label="Summary (visible collapsed)" value={metric.isSummary} onChange={(e) => handleField('isSummary', e.currentTarget.checked)} />
        <Checkbox label="Sparkline" value={metric.showSparkline} onChange={(e) => handleField('showSparkline', e.currentTarget.checked)} />
      </div>

      <div className="topo-editor-section-title">Data binding</div>
      <div className="topo-editor-field">
        <label>Datasource</label>
        <DataSourcePicker
          current={metric.datasourceUid || null}
          onChange={(ds) => handleField('datasourceUid', ds.uid)}
          noDefault
        />
      </div>
      {metric.datasourceUid && dsType === 'prometheus' && (
        <div className="topo-editor-field">
          <label>Metric name <span style={{ fontSize: 9, color: '#4c566a' }}>({availableMetrics.length} available)</span></label>
          <Select
            options={availableMetrics}
            value={metric.query || null}
            onChange={(v) => handleField('query', v.value!)}
            allowCustomValue
            isLoading={loadingMetrics}
            placeholder={loadingMetrics ? 'Loading metrics...' : 'Select or type query...'}
            isClearable
          />
        </div>
      )}

      {/* ═══════════ CloudWatch query editor ═══════════ */}
      {metric.datasourceUid && dsType === 'cloudwatch' && (
        <>
          <div className="topo-editor-section-title">CloudWatch query</div>
          <div className="topo-editor-field">
            <label>Namespace</label>
            <Input
              value={metric.queryConfig?.namespace || ''}
              onChange={(e) => updateQueryConfig('namespace', e.currentTarget.value || undefined)}
              placeholder="AWS/ApplicationELB"
            />
          </div>
          <div className="topo-editor-field">
            <label>Metric name</label>
            <Input
              value={metric.queryConfig?.metricName || ''}
              onChange={(e) => updateQueryConfig('metricName', e.currentTarget.value || undefined)}
              placeholder="RequestCount"
            />
          </div>
          <div className="topo-editor-field">
            <label>
              Dimensions
              <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>key=value pairs (all required for the metric)</span>
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
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              onClick={addDim}
              style={{ marginTop: 4 }}
            >
              Add dimension
            </Button>
          </div>
          <div className="topo-editor-row">
            <div className="topo-editor-field" style={{ flex: 1 }}>
              <label>Stat</label>
              <Select
                options={CLOUDWATCH_STATS}
                value={metric.queryConfig?.stat || 'Average'}
                onChange={(v) => updateQueryConfig('stat', v.value || 'Average')}
              />
            </div>
            <div className="topo-editor-field" style={{ flex: 1 }}>
              <label>Period (s)</label>
              <Input
                type="number"
                value={metric.queryConfig?.period || 300}
                onChange={(e) => {
                  const n = parseInt(e.currentTarget.value, 10);
                  updateQueryConfig('period', Number.isFinite(n) && n > 0 ? n : undefined);
                }}
                placeholder="300"
              />
            </div>
          </div>
        </>
      )}

      {/* ═══════════ Infinity query editor ═══════════ */}
      {metric.datasourceUid && dsType === 'yesoreyeram-infinity-datasource' && (
        <>
          <div className="topo-editor-section-title">Infinity query</div>
          <div className="topo-editor-field">
            <label>URL</label>
            <Input
              value={metric.queryConfig?.url || ''}
              onChange={(e) => updateQueryConfig('url', e.currentTarget.value || undefined)}
              placeholder="https://api.example.com/data"
            />
          </div>
          <div className="topo-editor-row">
            <div className="topo-editor-field" style={{ flex: 1 }}>
              <label>Method</label>
              <Select
                options={INFINITY_METHODS}
                value={metric.queryConfig?.method || 'GET'}
                onChange={(v) => updateQueryConfig('method', v.value || 'GET')}
              />
            </div>
            <div className="topo-editor-field" style={{ flex: 2 }}>
              <label>
                Root selector
                <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>JSON path to the value array</span>
              </label>
              <Input
                value={metric.queryConfig?.rootSelector || ''}
                onChange={(e) => updateQueryConfig('rootSelector', e.currentTarget.value || undefined)}
                placeholder="data.result"
              />
            </div>
          </div>
          {metric.queryConfig?.method === 'POST' && (
            <div className="topo-editor-field">
              <label>
                Body
                <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>raw JSON sent as request body</span>
              </label>
              <TextArea
                value={metric.queryConfig?.body || ''}
                onChange={(e) => updateQueryConfig('body', e.currentTarget.value || undefined)}
                placeholder='{"query": "..."}'
                rows={3}
              />
            </div>
          )}
        </>
      )}

      {/* ═══════════ Generic fallback for any other datasource ═══════════
          testdata, loki, elasticsearch, graphite, tempo, mssql, mysql, etc.
          Renders a plain query textarea plus a hint pointing at the refId
          field as the alternative binding path (panel-query matching). */}
      {metric.datasourceUid && dsType && !['prometheus', 'cloudwatch', 'yesoreyeram-infinity-datasource'].includes(dsType) && (
        <>
          <div className="topo-editor-section-title">Query</div>
          <div className="topo-editor-field">
            <label>
              Query <span style={{ fontSize: 9, color: '#4c566a' }}>{dsType} native syntax</span>
            </label>
            <TextArea
              value={metric.query || ''}
              onChange={(e) => handleField('query', e.currentTarget.value)}
              placeholder={`Enter your ${dsType} query...`}
              rows={3}
            />
          </div>
          <div style={{ fontSize: 10, color: '#616e88', padding: '4px 0 8px' }}>
            Or leave this empty and set <strong>Panel query refId</strong> above — the plugin will
            read values from a matching Grafana panel query added in the Queries tab below.
          </div>
        </>
      )}

      <div className="topo-editor-section-title">Thresholds</div>
      <ThresholdList thresholds={metric.thresholds || []} onChange={(t) => handleField('thresholds', t)} />
    </CollapsableSection>
  );
};
