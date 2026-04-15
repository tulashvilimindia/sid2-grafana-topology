import React, { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from '@grafana/ui';
import { TopologyNode, FiringAlert, MetricValue, STATUS_COLORS, ACCENT_COLOR } from '../types';
import { queryDatasourceRange, TimeseriesPoint } from '../utils/datasourceQuery';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * Human-readable "updated Ns ago" from a fetchedAt ms timestamp.
 * Returns null when the timestamp is missing or in the future (clock skew).
 */
function formatFreshness(fetchedAt: number | undefined, now: number): string | null {
  if (!fetchedAt) { return null; }
  const deltaSec = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  if (deltaSec < 5) { return 'just now'; }
  if (deltaSec < 60) { return `${deltaSec}s ago`; }
  if (deltaSec < 3600) { return `${Math.floor(deltaSec / 60)}m ago`; }
  return `${Math.floor(deltaSec / 3600)}h ago`;
}

/**
 * Replace ${token} placeholders in a URL template with values from the node.
 * Source map: { ...node.alertLabelMatchers, name: node.name, id: node.id }.
 * Unknown tokens are left as-is so typos are visible to the user.
 */
function interpolateUrl(urlTemplate: string, node: TopologyNode): string {
  const ctx: Record<string, string> = {
    ...(node.alertLabelMatchers || {}),
    name: node.name,
    id: node.id,
  };
  return urlTemplate.replace(/\$\{([^}]+)\}/g, (match, key) => ctx[key] ?? match);
}

interface PopupProps {
  node: TopologyNode;
  firingAlerts?: FiringAlert[];
  onClose: () => void;
  // When defined, renders an "Edit" button in the header that calls this
  // handler. TopologyPanel only wires it in edit mode so the button is
  // hidden in view mode where the editor is not reachable.
  onEdit?: () => void;
  /** Per-metric runtime state from TopologyPanel — source of fetchedAt. */
  metricValues?: Record<string, MetricValue>;
  /** SLO for freshness display in seconds. Default 60. */
  freshnessSLOSec?: number;
  /** Grafana template-variable interpolator. Propagated to queryDatasourceRange so
   *  sparklines respect $env / $region / etc. matching the instant-query behavior
   *  in useSelfQueries. When undefined, queries are fetched with literal tokens. */
  replaceVars?: (value: string) => string;
}

interface MetricTimeseries {
  metricId: string;
  label: string;
  points: TimeseriesPoint[];
  current: number | null;
}

export const NodePopup: React.FC<PopupProps> = ({
  node,
  firingAlerts,
  onClose,
  onEdit,
  metricValues,
  freshnessSLOSec = 60,
  replaceVars,
}) => {
  // Focus trap: on mount, move focus into the popup and trap Tab cycling;
  // Escape calls onClose; on unmount restore focus to whatever was focused
  // before the popup opened. Required for Grafana catalog a11y guidelines.
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, onClose, true);

  const [seriesData, setSeriesData] = useState<MetricTimeseries[]>([]);
  const [loading, setLoading] = useState(true);
  // "now" ticks every 15 seconds so the freshness label ("Updated 30s ago")
  // and the Stale pill update live while the popup stays open, instead of
  // being frozen at render time. 15s cadence is cheap and gives 4 ticks per
  // typical 60s SLO window — enough resolution to see a metric cross the
  // staleness threshold without burning CPU.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // Stable dependency: metric IDs string instead of array reference (CR-25)
  const metricIds = node.metrics.map((m) => m.id).join(',');

  // Fetch timeseries for all summary metrics (CR-15: with AbortController)
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    const fetchAll = async () => {
      const summaryMetrics = node.metrics.filter((m) => m.isSummary).slice(0, 4);
      const results: MetricTimeseries[] = [];

      for (const metric of summaryMetrics) {
        // queryDatasourceRange routes by datasource type — Prometheus uses the PromQL
        // query string, CloudWatch uses metric.queryConfig, Infinity returns [].
        const points = await queryDatasourceRange(
          metric.datasourceUid,
          metric.query,
          metric.queryConfig,
          controller.signal,
          replaceVars
        );
        if (cancelled) {
          return;
        }
        results.push({
          metricId: metric.id,
          label: metric.label,
          points,
          current: points.length > 0 ? points[points.length - 1].value : null,
        });
      }

      if (!cancelled) {
        setSeriesData(results);
        setLoading(false);
      }
    };

    fetchAll();
    return () => { cancelled = true; controller.abort(); };
    // metricIds is a stable hash of node.metrics[].id; node.metrics listed to satisfy exhaustive-deps.
    // replaceVars comes from PanelProps and is stable within a panel lifetime (same pattern as useSelfQueries).
  }, [node.id, node.metrics, metricIds, replaceVars]);

  return (
    <div
      ref={containerRef}
      className="topology-popup"
      style={{ position: 'relative', left: 0, top: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="topology-popup-header">
        <span className="topology-popup-title">{node.name}</span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit node"
            title="Open in editor"
            style={{
              background: 'transparent',
              border: '1px solid #4c566a',
              color: '#d8dee9',
              borderRadius: 3,
              padding: '1px 6px',
              fontSize: 10,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              marginRight: 4,
            }}
          >
            <Icon name="edit" size="xs" />
            Edit
          </button>
        )}
        <button className="topology-popup-close" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      {node.observabilityLinks && node.observabilityLinks.length > 0 && (
        <div
          style={{
            padding: '6px 8px',
            borderBottom: '1px solid #2d3748',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          {node.observabilityLinks.map((link, i) => (
            <a
              key={link.url || `${link.label}-${i}`}
              href={interpolateUrl(link.url, node)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 3,
                background: '#5e81ac22',
                color: '#5e81ac',
                border: '1px solid #5e81ac44',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <Icon name={((link.icon || 'external-link-alt') as IconName)} size="xs" />
              {link.label}
            </a>
          ))}
        </div>
      )}
      {firingAlerts && firingAlerts.length > 0 && (
        <div style={{ padding: '6px 8px', borderBottom: '1px solid #2d3748' }}>
          <div style={{ fontSize: 10, color: '#616e88', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Firing alerts ({firingAlerts.length})
          </div>
          {firingAlerts.map((alert, i) => {
            const badgeColor = alert.state === 'firing' ? STATUS_COLORS.critical : STATUS_COLORS.warning;
            const ruleHref = alert.ruleUid
              ? `/alerting/grafana/${alert.ruleUid}/view`
              : `/alerting/list?search=${encodeURIComponent(alert.ruleName)}`;
            const summary = alert.annotations?.summary || alert.annotations?.description;
            const runbookUrl = alert.annotations?.runbook_url;
            return (
              <div key={`${alert.ruleName}-${i}`} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span
                    style={{
                      background: badgeColor + '22',
                      color: badgeColor,
                      border: `1px solid ${badgeColor}44`,
                      borderRadius: 2,
                      padding: '0 4px',
                      fontSize: 9,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}
                  >
                    {alert.state}
                  </span>
                  <a
                    href={ruleHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: badgeColor,
                      textDecoration: 'none',
                      borderBottom: `1px dotted ${badgeColor}66`,
                    }}
                  >
                    {alert.ruleName}
                  </a>
                  {runbookUrl && (
                    <a
                      href={runbookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        marginLeft: 'auto',
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 2,
                        background: '#5e81ac22',
                        color: '#5e81ac',
                        border: '1px solid #5e81ac44',
                        textDecoration: 'none',
                        textTransform: 'uppercase',
                        letterSpacing: 0.3,
                      }}
                    >
                      Runbook
                    </a>
                  )}
                </div>
                {summary && (
                  <div
                    style={{
                      fontSize: 10,
                      color: '#616e88',
                      marginLeft: 34,
                      marginTop: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 260,
                    }}
                    title={summary}
                  >
                    {summary}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {loading && <div className="topology-popup-loading">Loading trends...</div>}
      {!loading && seriesData.map((series) => {
        const mv = metricValues?.[series.metricId];
        const freshness = formatFreshness(mv?.fetchedAt, now);
        const isStale = mv?.fetchedAt
          ? now - mv.fetchedAt > freshnessSLOSec * 1000
          : false;
        // Fall back to the card-level MetricValue.formatted when the range
        // fetch returned no points (Infinity snapshots, CloudWatch failures,
        // etc.). Shows the known-good scalar instead of a misleading "N/A".
        const displayValue = series.current !== null
          ? series.current.toFixed(1)
          : (mv?.formatted ?? 'N/A');
        return (
          <div key={series.metricId} className="topology-popup-metric">
            <div className="topology-popup-metric-header">
              <span>{series.label}</span>
              <span className="topology-popup-metric-value">
                {displayValue}
              </span>
            </div>
            {freshness && (
              <div
                style={{
                  fontSize: 9,
                  color: isStale ? STATUS_COLORS.warning : '#616e88',
                  marginTop: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title={
                  isStale
                    ? `Stale — exceeds ${freshnessSLOSec}s SLO`
                    : 'Self-query freshness'
                }
              >
                <span>Updated {freshness}</span>
                {isStale && (
                  <span
                    style={{
                      fontSize: 8,
                      padding: '0 3px',
                      borderRadius: 2,
                      background: STATUS_COLORS.warning + '22',
                      color: STATUS_COLORS.warning,
                      border: `1px solid ${STATUS_COLORS.warning}44`,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}
                  >
                    Stale
                  </span>
                )}
              </div>
            )}
            {series.points.length > 0 && (
              <MiniSparkline points={series.points} height={30} />
            )}
          </div>
        );
      })}
      {!loading && seriesData.length === 0 && (
        <div className="topology-popup-loading">No metrics configured</div>
      )}
    </div>
  );
};

/** Tiny SVG sparkline chart */
const MiniSparkline: React.FC<{ points: TimeseriesPoint[]; height: number }> = ({ points, height }) => {
  if (points.length < 2) {
    return null;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const range = max - min;
  const width = 200;

  const pathData = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p.value - min) / range) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={pathData} fill="none" stroke={ACCENT_COLOR} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};
