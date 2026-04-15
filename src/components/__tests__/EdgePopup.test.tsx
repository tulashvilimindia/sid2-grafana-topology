// Mock @grafana/ui BEFORE importing — Icon is the only real component used.
jest.mock('@grafana/ui', () => ({
  Icon: ({ name }: { name: string }) => {
    const React = require('react');
    return React.createElement('span', { 'data-testid': 'grafana-icon' }, name);
  },
  IconName: {},
}));

jest.mock('../../utils/datasourceQuery', () => ({
  queryDatasourceRange: jest.fn().mockResolvedValue([]),
  TimeseriesPoint: {},
}));

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { EdgePopup } from '../EdgePopup';
import { TopologyEdge, EdgeRuntimeState, DEFAULT_EDGE } from '../../types';
import * as dsq from '../../utils/datasourceQuery';

const queryDatasourceRange = dsq.queryDatasourceRange as jest.Mock;

function makeEdge(overrides: Partial<TopologyEdge> = {}): TopologyEdge {
  return {
    ...(DEFAULT_EDGE as TopologyEdge),
    id: 'e-1',
    sourceId: 'n-src',
    targetId: 'n-dst',
    thresholds: [
      { value: 0, color: 'green' },
      { value: 70, color: 'yellow' },
      { value: 90, color: 'red' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  queryDatasourceRange.mockClear();
  queryDatasourceRange.mockResolvedValue([]);
});

describe('EdgePopup', () => {
  test('renders source → target header', () => {
    render(
      <EdgePopup
        edge={makeEdge()}
        sourceName="Web"
        targetName="DB"
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText(/Web/)).toBeInTheDocument();
    expect(screen.getByText(/DB/)).toBeInTheDocument();
  });

  test('close button fires onClose', () => {
    const onClose = jest.fn();
    render(
      <EdgePopup
        edge={makeEdge()}
        sourceName="Web"
        targetName="DB"
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('shows "No metric configured" when edge has no metric', async () => {
    render(
      <EdgePopup
        edge={makeEdge({ metric: undefined })}
        sourceName="Web"
        targetName="DB"
        onClose={jest.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('No metric configured')).toBeInTheDocument();
    });
    expect(queryDatasourceRange).not.toHaveBeenCalled();
  });

  test('fetches timeseries via queryDatasourceRange when metric is set', async () => {
    queryDatasourceRange.mockResolvedValueOnce([
      { time: 1, value: 10 },
      { time: 2, value: 20 },
      { time: 3, value: 30 },
    ]);
    const edge = makeEdge({
      metric: { datasourceUid: 'prom', query: 'rate(x[5m])', alias: 'rps' },
    });
    render(
      <EdgePopup
        edge={edge}
        sourceName="Web"
        targetName="DB"
        onClose={jest.fn()}
      />
    );
    await waitFor(() => {
      expect(queryDatasourceRange).toHaveBeenCalledTimes(1);
    });
    expect(queryDatasourceRange).toHaveBeenCalledWith(
      'prom',
      'rate(x[5m])',
      undefined,
      expect.any(AbortSignal),
      undefined
    );
  });

  test('falls back to runtimeState.formattedLabel when fetch returns empty', async () => {
    const runtimeState: EdgeRuntimeState = {
      edgeId: 'e-1',
      status: 'saturated',
      formattedLabel: '42 rps',
      thickness: 2,
      color: '#ebcb8b',
      animationSpeed: 1.4,
    };
    render(
      <EdgePopup
        edge={makeEdge({ metric: { datasourceUid: 'prom', query: 'q', alias: 'rps' } })}
        runtimeState={runtimeState}
        sourceName="Web"
        targetName="DB"
        onClose={jest.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('42 rps')).toBeInTheDocument();
    });
  });

  test('highlights current threshold band matching runtimeState.status', async () => {
    const runtimeState: EdgeRuntimeState = {
      edgeId: 'e-1',
      status: 'saturated',
      thickness: 2,
      color: '#ebcb8b',
      animationSpeed: 1.4,
    };
    render(
      <EdgePopup
        edge={makeEdge({ metric: { datasourceUid: 'prom', query: 'q', alias: 'rps' } })}
        runtimeState={runtimeState}
        sourceName="Web"
        targetName="DB"
        onClose={jest.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('≥ 70')).toBeInTheDocument();
    });
    // The saturated pill (yellow, matches state) gets title="Current band".
    const yellowPill = screen.getByText('≥ 70');
    expect(yellowPill.getAttribute('title')).toBe('Current band');
    // The red pill does not.
    const redPill = screen.getByText('≥ 90');
    expect(redPill.getAttribute('title')).toBeNull();
  });

  test('Edit button is absent when onEdit is undefined', () => {
    render(
      <EdgePopup
        edge={makeEdge()}
        sourceName="Web"
        targetName="DB"
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByLabelText('Edit edge')).toBeNull();
  });

  test('Edit button fires onEdit when provided', () => {
    const onEdit = jest.fn();
    render(
      <EdgePopup
        edge={makeEdge()}
        sourceName="Web"
        targetName="DB"
        onClose={jest.fn()}
        onEdit={onEdit}
      />
    );
    fireEvent.click(screen.getByLabelText('Edit edge'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test('virtual edge (id contains ::) still fetches parent metric config', async () => {
    queryDatasourceRange.mockResolvedValueOnce([]);
    const edge = makeEdge({
      id: 'parent::target1',
      metric: { datasourceUid: 'prom-vx', query: 'parent_q', alias: 'rps' },
    });
    render(
      <EdgePopup
        edge={edge}
        sourceName="Web"
        targetName="DB"
        onClose={jest.fn()}
      />
    );
    await waitFor(() => {
      expect(queryDatasourceRange).toHaveBeenCalledTimes(1);
    });
    expect(queryDatasourceRange.mock.calls[0][0]).toBe('prom-vx');
    expect(queryDatasourceRange.mock.calls[0][1]).toBe('parent_q');
  });
});
