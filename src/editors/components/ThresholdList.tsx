import React, { useCallback } from 'react';
import { Button, IconButton, Input } from '@grafana/ui';
import { ThresholdStep } from '../../types';
import '../editors.css';

const COLORS: Array<'green' | 'yellow' | 'red'> = ['green', 'yellow', 'red'];

function cycleColor(current: 'green' | 'yellow' | 'red'): 'green' | 'yellow' | 'red' {
  return COLORS[(COLORS.indexOf(current) + 1) % 3];
}

interface Props {
  thresholds: ThresholdStep[];
  onChange: (thresholds: ThresholdStep[]) => void;
}

export const ThresholdList: React.FC<Props> = ({ thresholds, onChange }) => {
  const handleAdd = useCallback(() => {
    onChange([...thresholds, { value: 0, color: 'green' }]);
  }, [thresholds, onChange]);

  const handleDelete = useCallback((idx: number) => {
    onChange(thresholds.filter((_, i) => i !== idx));
  }, [thresholds, onChange]);

  const handleValueChange = useCallback((idx: number, value: number) => {
    onChange(thresholds.map((t, i) => (i === idx ? { ...t, value } : t)));
  }, [thresholds, onChange]);

  const handleColorCycle = useCallback((idx: number) => {
    onChange(thresholds.map((t, i) => (i === idx ? { ...t, color: cycleColor(t.color) } : t)));
  }, [thresholds, onChange]);

  return (
    <div>
      {thresholds.map((t, idx) => (
        <div key={idx} className="topo-threshold-row">
          <div
            className={`topo-threshold-color ${t.color}`}
            role="button"
            tabIndex={0}
            aria-label={`Color: ${t.color} (click to cycle)`}
            onClick={() => handleColorCycle(idx)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleColorCycle(idx); } }}
            title={`${t.color} (click to change)`}
          />
          <div className="topo-threshold-value">
            <Input
              type="number"
              value={t.value}
              onChange={(e) => handleValueChange(idx, parseFloat(e.currentTarget.value) || 0)}
              width={12}
            />
          </div>
          <IconButton name="trash-alt" size="sm" onClick={() => handleDelete(idx)} tooltip="Remove threshold" />
        </div>
      ))}
      <Button size="sm" variant="secondary" icon="plus" onClick={handleAdd} style={{ marginTop: 4 }}>
        Add threshold
      </Button>
    </div>
  );
};
