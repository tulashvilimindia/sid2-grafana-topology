import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { CollapsableSection, Input, Checkbox, IconButton, Select, Button, TextArea } from '@grafana/ui';
import { DataSourcePicker, getDataSourceSrv } from '@grafana/runtime';
import { NodeMetricConfig, DatasourceQueryConfig } from '../../types';
import { ThresholdList } from './ThresholdList';
import {
  getCloudWatchDefaultRegion,
  fetchCwNamespaces,
  fetchCwMetrics,
  fetchCwDimensionKeys,
} from '../../utils/cloudwatchResources';
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
  // CloudWatch autocomplete state — populated from Grafana's CW resource API
  // on datasource / namespace / metric changes. Dropdowns fall back to plain
  // text inputs via allowCustomValue so manual entry still works when the
  // datasource can't reach AWS.
  const [cwRegion, setCwRegion] = useState<string>('');
  const [cwNamespaces, setCwNamespaces] = useState<Array<{ label: string; value: string }>>([]);
  const [cwMetricNames, setCwMetricNames] = useState<Array<{ label: string; value: string }>>([]);
  const [cwDimKeys, setCwDimKeys] = useState<Array<{ label: string; value: string }>>([]);
  const [cwError, setCwError] = useState<string | null>(null);

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

  // When datasource changes, capture its type and discover Prometheus metric
  // names or seed the CloudWatch region + namespace list depending on type.
  useEffect(() => {
    if (!metric.datasourceUid) {
      setAvailableMetrics([]);
      setDsType('');
      setCwRegion('');
      setCwNamespaces([]);
      setCwMetricNames([]);
      setCwDimKeys([]);
      setCwError(null);
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
        } else if (ds.type === 'cloudwatch') {
          setAvailableMetrics([]);
          setCwError(null);
          const region = getCloudWatchDefaultRegion(metric.datasourceUid);
          setCwRegion(region);
          try {
            const namespaces = await fetchCwNamespaces(metric.datasourceUid, region);
            if (cancelled) {return;}
            setCwNamespaces(namespaces.map((n) => ({ label: n, value: n })));
          } catch (err) {
            if (!cancelled) {
              setCwError(`Namespaces: ${(err as Error).message}`);
              setCwNamespaces([]);
            }
          }
        } else {
          // Reset stale state when switching to a non-specialized DS type
          setAvailableMetrics([]);
          setCwNamespaces([]);
          setCwMetricNames([]);
          setCwDimKeys([]);
          setCwError(null);
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

  // When the CloudWatch namespace changes, fetch the list of metric names
  // available in that namespace.
  useEffect(() => {
    const namespace = metric.queryConfig?.namespace;
    if (dsType !== 'cloudwatch' || !metric.datasourceUid || !cwRegion || !namespace) {
      setCwMetricNames([]);
      return;
    }
    let cancelled = false;
    fetchCwMetrics(metric.datasourceUid, cwRegion, namespace)
      .then((names) => {
        if (cancelled) {return;}
        setCwMetricNames(names.map((n) => ({ label: n, value: n })));
      })
      .catch((err) => {
        if (!cancelled) {
          setCwError(`Metrics: ${(err as Error).message}`);
          setCwMetricNames([]);
        }
      });
    return () => { cancelled = true; };
  }, [dsType, metric.datasourceUid, cwRegion, metric.queryConfig?.namespace]);

  // When the CloudWatch metric name changes, fetch the list of dimension keys
  // valid for that metric. Used to populate the dimension-key dropdown.
  useEffect(() => {
    const namespace = metric.queryConfig?.namespace;
    const metricName = metric.queryConfig?.metricName;
    if (dsType !== 'cloudwatch' || !metric.datasourceUid || !cwRegion || !namespace || !metricName) {
      setCwDimKeys([]);
      return;
    }
    let cancelled = false;
    fetchCwDimensionKeys(metric.datasourceUid, cwRegion, namespace, metricName)
      .then((keys) => {
        if (cancelled) {return;}
        setCwDimKeys(keys.map((k) => ({ label: k, value: k })));
      })
      .catch(() => {
        // Dimension keys are optional — fail silently
      });
    return () => { cancelled = true; };
  }, [dsType, metric.datasourceUid, cwRegion, metric.queryConfig?.namespace, metric.queryConfig?.metricName]);

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
          <div className="topo-editor-section-title">
            CloudWatch query
            {cwRegion && <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 6 }}>region {cwRegion}</span>}
          </div>
          {cwError && (
            <div style={{ fontSize: 10, color: '#bf616a', padding: '4px 0' }}>
              {cwError} — check AWS credentials in the datasource config, or type values manually.
            </div>
          )}
          <div className="topo-editor-field">
            <label>
              Namespace
              <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>({cwNamespaces.length} available)</span>
            </label>
            <Select
              options={cwNamespaces}
              value={metric.queryConfig?.namespace || null}
              onChange={(v) => updateQueryConfig('namespace', v.value || undefined)}
              allowCustomValue
              isClearable
              placeholder={cwNamespaces.length > 0 ? 'Select namespace...' : 'AWS/ApplicationELB'}
            />
          </div>
          <div className="topo-editor-field">
            <label>
              Metric name
              <span style={{ fontSize: 9, color: '#4c566a', marginLeft: 4 }}>({cwMetricNames.length} available)</span>
            </label>
            <Select
              options={cwMetricNames}
              value={metric.queryConfig?.metricName || null}
              onChange={(v) => updateQueryConfig('metricName', v.value || undefined)}
              allowCustomValue
              isClearable
              placeholder={cwMetricNames.length > 0 ? 'Select metric...' : 'RequestCount'}
              isDisabled={!metric.queryConfig?.namespace}
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
                <div style={{ width: 130 }}>
                  <Select
                    options={cwDimKeys}
                    value={entry.key ? { label: entry.key, value: entry.key } : null}
                    onChange={(v) => updateDim(idx, 'key', v.value || '')}
                    allowCustomValue
                    placeholder="key"
                  />
                </div>
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
