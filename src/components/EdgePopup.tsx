import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@grafana/ui';
import { TopologyEdge, EdgeRuntimeState, STATUS_COLORS, ACCENT_COLOR, EdgeStatus } from '../types';
import { queryDatasourceRange, TimeseriesPoint } from '../utils/datasourceQuery';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * EdgePopup — floating detail card for a clicked edge.
 *
 * Mirrors NodePopup in structure but scoped to a single edge metric instead
 * of an array of node metrics. Fetches a time-series on mount (when a metric
 * is configured), renders a sparkline, and shows the threshold band the
 * current value falls into.
 *
 * Virtual edges — those whose id contains '::' because they were expanded
 * from a targetQuery at runtime — carry their parent's metric config via
 * the normal edge spread, so the fetch path is identical for both.
 */

interface EdgePopupProps {
  edge: TopologyEdge;
  runtimeState?: EdgeRuntimeState;
  sourceName: string;
  targetName: string;
  onClose: () => void;
  /** When set, renders an Edit button that calls this handler. */
  onEdit?: () => void;
  /** Grafana template-variable interpolator. Propagated to queryDatasourceRange so
   *  the edge sparkline respects $env / $region / etc. */
  replaceVars?: (value: string) => string;
}

export const EdgePopup: React.FC<EdgePopupProps> = ({
  edge, runtimeState, sourceName, targetName, onClose, onEdit, replaceVars,
}) => {
  // Focus trap: see NodePopup for rationale. Grafana catalog a11y.
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, onClose, true);

  const [points, setPoints] = useState<TimeseriesPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!edge.metric) {
      setLoading(false);
      setPoints([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    const { datasourceUid, query, queryConfig } = edge.metric;
    queryDatasourceRange(datasourceUid, query, queryConfig, controller.signal, replaceVars)
      .then((result) => {
        if (cancelled) { return; }
        setPoints(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) { return; }
        setPoints([]);
        setLoading(false);
      });

    return () => { cancelled = true; controller.abort(); };
    // replaceVars comes from PanelProps and is stable within a panel lifetime.
  }, [edge.id, edge.metric, replaceVars]);

  const currentValue = runtimeState?.formattedLabel
    ?? (points.length > 0 ? points[points.length - 1].value.toFixed(1) : 'N/A');

  return (
    <div
      ref={containerRef}
      className="topology-popup"
      style={{ position: 'relative', left: 0, top: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="topology-popup-header">
        <span className="topology-popup-title">
          {sourceName} → {targetName}
        </span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit edge"
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
              fontFamily: 'inherit',
            }}
          >
            <Icon name="edit" size="xs" />
            Edit
          </button>
        )}
        <button className="topology-popup-close" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      <div
        style={{
          padding: '4px 8px 6px',
          fontSize: 10,
          color: '#616e88',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          display: 'flex',
          gap: 8,
        }}
      >
        <span>{edge.type}</span>
        {edge.bidirectional && <span>bidirectional</span>}
      </div>

      {!edge.metric && (
        <div className="topology-popup-loading">No metric configured</div>
      )}

      {edge.metric && (
        <div className="topology-popup-metric">
          <div className="topology-popup-metric-header">
            <span>{edge.metric.alias || 'metric'}</span>
            <span
              className="topology-popup-metric-value"
              style={{ color: runtimeState?.color || '#d8dee9' }}
            >
              {currentValue}
            </span>
          </div>

          {loading && <div className="topology-popup-loading">Loading trends...</div>}

          {!loading && points.length >= 2 && (
            <MiniSparkline points={points} height={30} color={runtimeState?.color || ACCENT_COLOR} />
          )}

          {edge.thresholds && edge.thresholds.length > 0 && (
            <ThresholdBar thresholds={edge.thresholds} currentStatus={runtimeState?.status} />
          )}
        </div>
      )}
    </div>
  );
};

// Inline sparkline — duplicated from NodePopup to keep the diff
// narrow. A later refactor can extract it into a shared component.
const MiniSparkline: React.FC<{ points: TimeseriesPoint[]; height: number; color: string }> = ({ points, height, color }) => {
  if (points.length < 2) { return null; }
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
      <path d={pathData} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};

/**
 * Threshold band visualisation — one pill per configured threshold, the
 * pill matching the current runtime status is highlighted with a solid
 * border so the user can see which band they are currently in.
 */
const ThresholdBar: React.FC<{
  thresholds: Array<{ value: number; color: string }>;
  currentStatus?: EdgeStatus;
}> = ({ thresholds, currentStatus }) => {
  const statusToColor: Record<string, string> = {
    healthy: '#a3be8c',
    saturated: '#ebcb8b',
    degraded: '#bf616a',
    down: '#bf616a',
    nodata: '#4c566a',
  };
  const currentColor = currentStatus ? statusToColor[currentStatus] : undefined;
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
      {thresholds.map((t, i) => {
        const pillColor = colorNameToHex(t.color);
        const highlighted = currentColor && pillColor.toLowerCase() === currentColor.toLowerCase();
        return (
          <div
            key={`${t.value}-${i}`}
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 2,
              background: pillColor + '22',
              color: pillColor,
              border: `1px solid ${pillColor}${highlighted ? 'ff' : '44'}`,
              fontWeight: highlighted ? 600 : 400,
            }}
            title={highlighted ? 'Current band' : undefined}
          >
            ≥ {t.value}
          </div>
        );
      })}
    </div>
  );
};

function colorNameToHex(name: string): string {
  switch (name) {
    case 'green': return STATUS_COLORS.ok;
    case 'yellow': return STATUS_COLORS.warning;
    case 'red': return STATUS_COLORS.critical;
    default: return name.startsWith('#') ? name : '#4c566a';
  }
}
