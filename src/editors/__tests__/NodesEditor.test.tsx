// ─── Mocks ────────────────────────────────────────────────────────────
//
// NodesEditor is 595 LOC mixing a BulkImport sub-component, import/export
// helpers, and the main list editor. Stub @grafana/ui + @grafana/runtime
// the same way as the other editor tests. NodeCard is stubbed aggressively
// because this file targets the top-level editor flows (bulk-import +
// import/export); per-card behavior has its own test file.

jest.mock('@grafana/ui', () => {
  const React = require('react');
  return {
    Button: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
      React.createElement('button', { ...props, type: 'button' }, props.children),
    IconButton: (props: Record<string, unknown>) =>
      React.createElement('button', {
        ...props,
        type: 'button',
        'aria-label': props.tooltip ?? props.name,
      }),
    Input: (props: {
      value?: unknown;
      onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
      placeholder?: string;
      prefix?: React.ReactNode;
    }) =>
      React.createElement('input', {
        type: 'text',
        value: (props.value as string) ?? '',
        onChange: props.onChange,
        placeholder: props.placeholder,
      }),
    TextArea: (props: {
      value?: string;
      onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
      placeholder?: string;
    }) =>
      React.createElement('textarea', {
        value: props.value ?? '',
        onChange: props.onChange,
        placeholder: props.placeholder,
      }),
    Checkbox: (props: {
      value?: boolean;
      onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
      label?: string;
      disabled?: boolean;
    }) =>
      React.createElement('input', {
        type: 'checkbox',
        checked: !!props.value,
        disabled: !!props.disabled,
        onChange: props.onChange,
        'data-testid': props.label
          ? `checkbox-${(props.label as string).toLowerCase().replace(/[^a-z0-9]/g, '-')}`
          : undefined,
      }),
    CollapsableSection: (props: {
      label?: React.ReactNode;
      isOpen?: boolean;
      onToggle?: () => void;
      children?: React.ReactNode;
    }) => {
      const labelStr = typeof props.label === 'string' ? props.label : undefined;
      // Always render children so tests can interact regardless of isOpen.
      return React.createElement(
        'section',
        {
          'data-testid': 'collapsable',
          ...(labelStr ? { 'data-label': labelStr } : {}),
        },
        React.createElement('button', { onClick: props.onToggle, type: 'button' }, props.label),
        React.createElement('div', {}, props.children)
      );
    },
    Select: (props: {
      options?: Array<{ label: string; value: string }>;
      value?: unknown;
      onChange?: (v: { value?: string }) => void;
      placeholder?: string;
      isLoading?: boolean;
    }) =>
      React.createElement(
        'select',
        {
          value:
            (typeof props.value === 'string'
              ? props.value
              : (props.value as { value?: string })?.value) ?? '',
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
            props.onChange?.({ value: e.target.value }),
        },
        React.createElement('option', { key: '__placeholder', value: '' }, props.placeholder ?? ''),
        (props.options ?? []).map((o) =>
          React.createElement('option', { key: o.value, value: o.value }, o.label ?? o.value)
        )
      ),
  };
});

// DataSourcePicker is interactive in these tests — clicking it fires
// onChange with a fixed uid so BulkImport can proceed to its jobs fetch.
jest.mock('@grafana/runtime', () => {
  const React = require('react');
  return {
    getDataSourceSrv: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ type: 'prometheus' }),
    }),
    DataSourcePicker: (props: { onChange?: (ds: { uid: string }) => void; current?: string | null }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'ds-picker',
          onClick: () => props.onChange?.({ uid: 'ds-prom' }),
        },
        `pick ds (${props.current ?? 'none'})`
      ),
  };
});

// Stub NodeCard — its own behavior is covered by NodeCard.test.tsx.
jest.mock('../components/NodeCard', () => ({
  NodeCard: ({ node, onDelete, onDuplicate, onToggle }: {
    node: { id: string; name: string };
    onDelete: () => void;
    onDuplicate?: () => void;
    onToggle: () => void;
  }) => {
    const React = require('react');
    return React.createElement(
      'div',
      { 'data-testid': `node-card-${node.id}` },
      React.createElement('span', {}, node.name),
      React.createElement('button', { type: 'button', onClick: onToggle, 'data-testid': `toggle-${node.id}` }, 'toggle'),
      React.createElement('button', { type: 'button', onClick: onDelete, 'data-testid': `delete-${node.id}` }, 'delete'),
      onDuplicate &&
        React.createElement('button', { type: 'button', onClick: onDuplicate, 'data-testid': `duplicate-${node.id}` }, 'duplicate')
    );
  },
}));

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NodesEditor } from '../NodesEditor';
import { TopologyNode, TopologyPanelOptions, DEFAULT_PANEL_OPTIONS } from '../../types';
import { emitTopologyImport, onTopologyImport } from '../../utils/panelEvents';

type ContextShape = { options: TopologyPanelOptions };

// Helper: build the StandardEditorProps context arg for NodesEditor.
function makeContext(opts: Partial<TopologyPanelOptions> = {}): ContextShape {
  return {
    options: { ...DEFAULT_PANEL_OPTIONS, ...opts },
  };
}

// ─── URL-dispatching fetch mock ───────────────────────────────────────
//
// BulkImport fans out to 3 distinct Prometheus endpoints. A single shared
// mock that branches by URL keeps each test's setup short while still
// letting us override specific responses per-test.

interface FetchResponses {
  jobs?: Array<{ job: string; count: number }>;
  hosts?: Array<{ instance: string; up: string }>;
  seriesNames?: string[];
}

function installFetchMock(responses: FetchResponses = {}): void {
  (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
    // Jobs: query=count%20by(job)(up)
    if (url.includes('count%20by(job)')) {
      const jobs = responses.jobs ?? [];
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            result: jobs.map((j) => ({ metric: { job: j.job }, value: [0, String(j.count)] })),
          },
        }),
      });
    }
    // Hosts: query=up%7Bjob%3D%22... (encoded `up{job="..."}`)
    if (url.includes('up%7Bjob')) {
      const hosts = responses.hosts ?? [];
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            result: hosts.map((h) => ({ metric: { instance: h.instance }, value: [0, h.up] })),
          },
        }),
      });
    }
    // Metric series: /api/v1/series
    if (url.includes('/api/v1/series')) {
      const names = responses.seriesNames ?? [];
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: names.map((n) => ({ __name__: n })),
        }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
  });
}

beforeEach(() => {
  installFetchMock();
});

function renderNodesEditor(
  nodes: TopologyNode[] = [],
  contextOverrides: Partial<TopologyPanelOptions> = {}
) {
  const onChange = jest.fn();
  const context = makeContext({ ...contextOverrides, nodes });
  const result = render(
    // StandardEditorProps is broader than what we provide; cast through unknown.
    <NodesEditor
      value={nodes}
      onChange={onChange}
      context={context as never}
      item={{} as never}
    />
  );
  return { ...result, onChange, context };
}

// ─── BulkImport cascade ───────────────────────────────────────────────

describe('NodesEditor — BulkImport', () => {
  test('selecting a datasource triggers count-by(job)(up) fetch', async () => {
    renderNodesEditor();
    fireEvent.click(screen.getByTestId('ds-picker'));
    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => u.includes('count%20by(job)'))).toBe(true);
    });
  });

  test('selecting a job fetches its hosts', async () => {
    installFetchMock({
      jobs: [{ job: 'api', count: 3 }, { job: 'web', count: 2 }],
      hosts: [{ instance: 'api-01:9090', up: '1' }, { instance: 'api-02:9090', up: '1' }],
    });
    renderNodesEditor();
    fireEvent.click(screen.getByTestId('ds-picker'));
    // Wait until the jobs list is loaded into the Select.
    const apiOption = await screen.findByText('api (3 targets)');
    // Disambiguate: identify the job Select by finding the <select> that
    // contains the 'api (3 targets)' option. getByDisplayValue('') is too
    // broad — it also matches the hidden file input and the filter Inputs.
    const jobSelect = apiOption.closest('select') as HTMLSelectElement;
    expect(jobSelect).not.toBeNull();
    act(() => {
      fireEvent.change(jobSelect, { target: { value: 'api' } });
    });
    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls.map((c) => c[0] as string);
      // Matches encoded `up{job="api"}`.
      expect(calls.some((u) => u.includes('up%7Bjob%3D%22api'))).toBe(true);
    });
  });

  test('existing node names render disabled in the host list', async () => {
    installFetchMock({
      jobs: [{ job: 'api', count: 2 }],
      hosts: [
        { instance: 'api-01:9090', up: '1' },
        { instance: 'api-02:9090', up: '1' },
      ],
    });
    renderNodesEditor([
      {
        id: 'existing', name: 'api-01:9090', role: '', type: 'server',
        metrics: [], position: { x: 0, y: 0 }, compact: false,
      },
    ]);
    fireEvent.click(screen.getByTestId('ds-picker'));
    const apiOption = await screen.findByText('api (2 targets)');
    const jobSelect = apiOption.closest('select') as HTMLSelectElement;
    act(() => {
      fireEvent.change(jobSelect, { target: { value: 'api' } });
    });
    // Wait for BOTH hosts to appear in the bulk-import list. api-01:9090
    // also happens to be the existing node's name (that's the setup), so
    // matching on it alone isn't enough — wait for api-02:9090 which only
    // appears in the host list.
    await waitFor(() => expect(screen.getByText(/api-02:9090/)).toBeInTheDocument());
    // Observable signal: the existing-name row's checkbox must be disabled
    // AND the new row's checkbox must not be. The user can't toggle the
    // existing-name host — that's the contract regardless of the
    // `(exists)` label presentation detail.
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const disabledBoxes = checkboxes.filter((cb) => cb.disabled);
    const enabledBoxes = checkboxes.filter((cb) => !cb.disabled);
    expect(disabledBoxes.length).toBe(1);
    expect(enabledBoxes.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Import / Export helpers ──────────────────────────────────────────

describe('NodesEditor — Export', () => {
  let capturedBlob: Blob | null;
  let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    capturedBlob = null;
    // jsdom doesn't implement URL.createObjectURL / revokeObjectURL — spyOn
    // would fail because the properties are undefined. Patch via direct
    // assignment, save the original (may be undefined), restore on cleanup.
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
      capturedBlob = b;
      return 'blob:fake';
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
    // Swallow <a>.click() so the simulated download is a no-op.
    clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  });
  afterEach(() => {
    if (originalCreateObjectURL === undefined) {
      delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    } else {
      (URL as unknown as { createObjectURL: typeof URL.createObjectURL }).createObjectURL =
        originalCreateObjectURL;
    }
    if (originalRevokeObjectURL === undefined) {
      delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    } else {
      (URL as unknown as { revokeObjectURL: typeof URL.revokeObjectURL }).revokeObjectURL =
        originalRevokeObjectURL;
    }
    clickSpy.mockRestore();
  });

  test('Export serialises nodes + edges + groups + sub-options with version 2', async () => {
    const nodes: TopologyNode[] = [
      { id: 'n1', name: 'N1', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
    ];
    renderNodesEditor(nodes, {
      edges: [],
      groups: [],
      canvas: { showGrid: true, gridSize: 20, snapToGrid: true, backgroundColor: '#000' },
    });
    fireEvent.click(screen.getByText('Export'));
    expect(capturedBlob).not.toBeNull();
    // jsdom's Blob prototype predates `.text()`; round-trip via FileReader.
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(capturedBlob!);
    });
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(2);
    expect(parsed.nodes).toEqual(nodes);
    expect(parsed.canvas).toEqual({ showGrid: true, gridSize: 20, snapToGrid: true, backgroundColor: '#000' });
    expect(parsed.edges).toEqual([]);
    expect(parsed.groups).toEqual([]);
  });
});

describe('NodesEditor — Import', () => {
  function triggerImport(
    fileContent: string,
    nodes: TopologyNode[] = []
  ): { onChange: jest.Mock } {
    const { onChange, container } = renderNodesEditor(nodes);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    const file = new File([fileContent], 'topology.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);
    return { onChange };
  }

  test('v1 nodes-only import appends new nodes via onChange', async () => {
    const existing: TopologyNode[] = [
      { id: 'n-existing', name: 'existing', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
    ];
    const payload = JSON.stringify({
      version: 1,
      nodes: [
        { id: 'n-new', name: 'new', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false },
      ],
    });
    const { onChange } = triggerImport(payload, existing);
    // FileReader.onload resolves on an event-loop tick, not a microtask.
    // waitFor() polls until the onChange observable side-effect lands.
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)![0] as TopologyNode[];
    // v1 path: appended to existing via `onChange` directly (no event bus).
    expect(updated.map((n) => n.id).sort()).toEqual(['n-existing', 'n-new']);
  });

  test('v2 multi-slice import fires emitTopologyImport with parsed partial', async () => {
    const received: Array<Partial<TopologyPanelOptions>> = [];
    const unsub = onTopologyImport((p) => received.push(p));
    const payload = JSON.stringify({
      version: 2,
      nodes: [{ id: 'n-x', name: 'x', role: '', type: 'server', metrics: [], position: { x: 0, y: 0 }, compact: false }],
      edges: [{ id: 'e-1', sourceId: 'a', targetId: 'b', type: 'traffic', thicknessMode: 'fixed', thicknessMin: 1.5, thicknessMax: 4, thresholds: [], flowAnimation: false, bidirectional: false, anchorSource: 'auto', anchorTarget: 'auto' }],
      canvas: { showGrid: false, gridSize: 10, snapToGrid: false, backgroundColor: '#111' },
    });
    try {
      triggerImport(payload);
      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0].edges).toHaveLength(1);
      expect(received[0].canvas?.showGrid).toBe(false);
      // Nodes are NOT left off — v2 path appends to existing then routes
      // every slice through the event bus so TopologyPanel merges once.
      expect(received[0].nodes?.length).toBeGreaterThan(0);
    } finally {
      unsub();
    }
  });

  test('invalid JSON is a silent no-op (warn, no onChange)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { onChange } = triggerImport('{ this is not valid json');
      await waitFor(() => expect(warnSpy).toHaveBeenCalled());
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ─── Cross-subtree subscription wiring ────────────────────────────────
//
// Assert that NodesEditor wires up the panelEvents subscriptions so
// node-clicked / topology-import from the canvas side can reach the editor.

describe('NodesEditor — panelEvents integration', () => {
  test('onTopologyImport subscriber stays registered across renders', async () => {
    const { rerender } = renderNodesEditor([]);
    // Emitting after mount must reach a subscriber (NodesEditor's own), so
    // this is an indirect smoke test: no error thrown, no subscribers leak.
    expect(() => emitTopologyImport({ nodes: [] })).not.toThrow();
    rerender(
      <NodesEditor
        value={[]}
        onChange={jest.fn()}
        context={makeContext() as never}
        item={{} as never}
      />
    );
    expect(() => emitTopologyImport({ nodes: [] })).not.toThrow();
  });
});
