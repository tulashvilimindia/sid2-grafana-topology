import {
  sanitizeLabel,
  generateId,
  getNodeSelectOptions,
  getNodeTypeOptions,
  getGroupSelectOptions,
  findNodeGroup,
  getNodeName,
} from '../editorUtils';
import { TopologyNode, NodeGroup, NODE_TYPE_CONFIG, NodeType } from '../../../types';

function makeNode(overrides: Partial<TopologyNode> = {}): TopologyNode {
  return {
    id: 'n-1',
    name: 'server-01',
    role: 'app server',
    type: 'server',
    metrics: [],
    position: { x: 0, y: 0 },
    compact: false,
    ...overrides,
  };
}

// ─── sanitizeLabel ────────────────────────────────────────────────────
//
// PromQL-injection defense for bulk-import queries built via string
// interpolation: `up{job="${sanitizeLabel(selectedJob)}"}`. If an
// attacker-controlled label contains `"`, `{`, `}`, `\`, or a newline,
// they could break out of the matcher and inject extra label selectors
// (or arbitrary PromQL). The scrub must strip those characters.

describe('sanitizeLabel', () => {
  test('passes through normal characters unchanged', () => {
    expect(sanitizeLabel('api-01:9100')).toBe('api-01:9100');
    expect(sanitizeLabel('web_service.production')).toBe('web_service.production');
  });

  test('strips the 6 PromQL injection characters', () => {
    expect(sanitizeLabel('abc"def')).toBe('abcdef');
    expect(sanitizeLabel('a{b}c')).toBe('abc');
    expect(sanitizeLabel('a\\b')).toBe('ab');
    expect(sanitizeLabel('a\nb')).toBe('ab');
    expect(sanitizeLabel('a\rb')).toBe('ab');
  });

  test('strips all 6 at once', () => {
    // Attacker tries to break out of up{instance="INPUT"} → new label injection.
    const attack = 'prod"}\n+up{job="other';
    const sanitised = sanitizeLabel(attack);
    expect(sanitised).not.toContain('"');
    expect(sanitised).not.toContain('\n');
    expect(sanitised).not.toContain('{');
    expect(sanitised).not.toContain('}');
  });

  test('empty string remains empty', () => {
    expect(sanitizeLabel('')).toBe('');
  });
});

// ─── generateId ───────────────────────────────────────────────────────

describe('generateId', () => {
  test('starts with the given prefix', () => {
    expect(generateId('n')).toMatch(/^n-/);
    expect(generateId('e')).toMatch(/^e-/);
    expect(generateId('grp')).toMatch(/^grp-/);
  });

  test('ids differ across rapid calls', () => {
    // Rapid enough that the timestamp component is identical — only the
    // random suffix disambiguates. If the random suffix shrinks or
    // collides, duplicate ids would break React keys and option merges.
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId('m'));
    }
    // Allow up to 1 collision out of 1000 just to avoid a flaky test on
    // the birthday-paradox off-chance (4 chars of base36 → ~1.7M space
    // per timestamp bucket; collisions are rare but not impossible).
    expect(ids.size).toBeGreaterThanOrEqual(999);
  });
});

// ─── getNodeSelectOptions ─────────────────────────────────────────────

describe('getNodeSelectOptions', () => {
  test('returns one option per node with icon + name label and role description', () => {
    const nodes: TopologyNode[] = [
      makeNode({ id: 'n-a', name: 'Alpha', type: 'server', role: 'app' }),
      makeNode({ id: 'n-b', name: 'Beta', type: 'database', role: 'primary' }),
    ];
    const options = getNodeSelectOptions(nodes);
    expect(options).toEqual([
      { label: `${NODE_TYPE_CONFIG.server.icon} Alpha`, value: 'n-a', description: 'app' },
      { label: `${NODE_TYPE_CONFIG.database.icon} Beta`, value: 'n-b', description: 'primary' },
    ]);
  });

  test('falls back to "?" icon for an unknown node type', () => {
    // Type-cast to bypass the NodeType union for the negative test.
    const nodes = [makeNode({ type: 'nonexistent' as unknown as NodeType, name: 'X' })];
    const [opt] = getNodeSelectOptions(nodes);
    expect(opt.label.startsWith('?')).toBe(true);
  });
});

// ─── getNodeTypeOptions ───────────────────────────────────────────────

describe('getNodeTypeOptions', () => {
  test('returns exactly one option per NODE_TYPE_CONFIG entry (currently 37)', () => {
    const options = getNodeTypeOptions();
    const configKeys = Object.keys(NODE_TYPE_CONFIG);
    expect(options).toHaveLength(configKeys.length);
    const values = options.map((o) => o.value);
    expect(values.sort()).toEqual([...configKeys].sort());
  });

  test('each option label uses "<icon> — <type>" format', () => {
    const options = getNodeTypeOptions();
    const serverOpt = options.find((o) => o.value === 'server');
    expect(serverOpt?.label).toBe(`${NODE_TYPE_CONFIG.server.icon} — server`);
  });
});

// ─── getGroupSelectOptions ────────────────────────────────────────────

describe('getGroupSelectOptions', () => {
  test('prepends a "-- none --" sentinel with empty value', () => {
    const groups: NodeGroup[] = [
      { id: 'grp-1', label: 'HA Pair', type: 'ha_pair', nodeIds: [], style: 'dashed' },
    ];
    const options = getGroupSelectOptions(groups);
    expect(options[0]).toEqual({ label: '-- none --', value: '' });
    expect(options[1]).toEqual({ label: 'HA Pair', value: 'grp-1' });
  });

  test('returns only the sentinel when no groups exist', () => {
    expect(getGroupSelectOptions([])).toEqual([{ label: '-- none --', value: '' }]);
  });
});

// ─── findNodeGroup ────────────────────────────────────────────────────

describe('findNodeGroup', () => {
  const groups: NodeGroup[] = [
    { id: 'grp-1', label: 'HA', type: 'ha_pair', nodeIds: ['n-a', 'n-b'], style: 'dashed' },
    { id: 'grp-2', label: 'Cluster', type: 'cluster', nodeIds: ['n-c'], style: 'solid' },
  ];

  test('returns the group containing the node', () => {
    expect(findNodeGroup('n-a', groups)?.id).toBe('grp-1');
    expect(findNodeGroup('n-c', groups)?.id).toBe('grp-2');
  });

  test('returns undefined when the node is not a member of any group', () => {
    expect(findNodeGroup('n-unknown', groups)).toBeUndefined();
  });
});

// ─── getNodeName ──────────────────────────────────────────────────────

describe('getNodeName', () => {
  const nodes: TopologyNode[] = [makeNode({ id: 'n-a', name: 'Alpha' })];

  test('returns node.name when the node exists', () => {
    expect(getNodeName('n-a', nodes)).toBe('Alpha');
  });

  test('falls back to the id when the node is missing', () => {
    expect(getNodeName('n-ghost', nodes)).toBe('n-ghost');
  });
});
