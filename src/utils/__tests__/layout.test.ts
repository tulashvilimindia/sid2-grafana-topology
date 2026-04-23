import { assignTiers, autoLayout, snapToGrid } from '../layout';
import { TopologyNode, TopologyEdge } from '../../types';

function makeNode(id: string, overrides: Partial<TopologyNode> = {}): TopologyNode {
  return {
    id,
    name: id,
    role: '',
    type: 'server',
    metrics: [],
    position: { x: 100, y: 100 },
    compact: false,
    ...overrides,
  };
}

function makeEdge(id: string, sourceId: string, targetId: string, overrides: Partial<TopologyEdge> = {}): TopologyEdge {
  return {
    id,
    sourceId,
    targetId,
    type: 'traffic',
    thicknessMode: 'fixed',
    thicknessMin: 1.5,
    thicknessMax: 4,
    thresholds: [],
    flowAnimation: true,
    bidirectional: false,
    anchorSource: 'auto',
    anchorTarget: 'auto',
    ...overrides,
  };
}

describe('assignTiers', () => {
  test('empty graph returns empty map', () => {
    expect(assignTiers([], []).size).toBe(0);
  });

  test('isolated nodes all go to tier 0', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const tiers = assignTiers(nodes, []);
    expect(tiers.get('a')).toBe(0);
    expect(tiers.get('b')).toBe(0);
    expect(tiers.get('c')).toBe(0);
  });

  test('linear chain assigns sequential tiers', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
    const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c'), makeEdge('e3', 'c', 'd')];
    const tiers = assignTiers(nodes, edges);
    expect(tiers.get('a')).toBe(0);
    expect(tiers.get('b')).toBe(1);
    expect(tiers.get('c')).toBe(2);
    expect(tiers.get('d')).toBe(3);
  });

  test('fan-out from single root', () => {
    const nodes = [makeNode('root'), makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [
      makeEdge('e1', 'root', 'a'),
      makeEdge('e2', 'root', 'b'),
      makeEdge('e3', 'root', 'c'),
    ];
    const tiers = assignTiers(nodes, edges);
    expect(tiers.get('root')).toBe(0);
    expect(tiers.get('a')).toBe(1);
    expect(tiers.get('b')).toBe(1);
    expect(tiers.get('c')).toBe(1);
  });

  test('bidirectional edge is skipped (HA pair treated as peers)', () => {
    const nodes = [makeNode('fw1'), makeNode('fw2')];
    const edges = [makeEdge('e1', 'fw1', 'fw2', { bidirectional: true })];
    const tiers = assignTiers(nodes, edges);
    // Both should be at tier 0 since bidirectional edges don't create hierarchy
    expect(tiers.get('fw1')).toBe(0);
    expect(tiers.get('fw2')).toBe(0);
  });

  test('cycle breaking — back-edge is skipped', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'a')];
    const tiers = assignTiers(nodes, edges);
    // Only forward edge counts — a at 0, b at 1
    expect(tiers.get('a')).toBe(0);
    expect(tiers.get('b')).toBe(1);
  });

  test('edge to unknown target is skipped', () => {
    const nodes = [makeNode('a')];
    const edges = [makeEdge('e1', 'a', 'ghost')];
    const tiers = assignTiers(nodes, edges);
    expect(tiers.get('a')).toBe(0);
    expect(tiers.size).toBe(1);
  });

  test('deepest path wins when multiple paths to same target', () => {
    // a → b → c AND a → c directly → c should be at tier 2 (deepest)
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [
      makeEdge('e1', 'a', 'b'),
      makeEdge('e2', 'b', 'c'),
      makeEdge('e3', 'a', 'c'),
    ];
    const tiers = assignTiers(nodes, edges);
    expect(tiers.get('c')).toBe(2);
  });

  test('diamond fan-in (A→B, A→C, B→D, C→D) assigns D to tier 2 exactly once', () => {
    // Regression for the `queued: Set<string>` guard at layout.ts:62-86.
    // Without the guard, D's incomingCount ticks past 0 via the second parent,
    // re-enqueuing D and reprocessing its descendants — O(N²) worst case.
    // With the guard, D is enqueued exactly once and the tier map has 4 entries.
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
    const edges = [
      makeEdge('e1', 'a', 'b'),
      makeEdge('e2', 'a', 'c'),
      makeEdge('e3', 'b', 'd'),
      makeEdge('e4', 'c', 'd'),
    ];
    const tiers = assignTiers(nodes, edges);
    expect(tiers.get('a')).toBe(0);
    expect(tiers.get('b')).toBe(1);
    expect(tiers.get('c')).toBe(1);
    expect(tiers.get('d')).toBe(2);
    expect(tiers.size).toBe(4);
  });
});

describe('autoLayout', () => {
  const config = { direction: 'top-down' as const, tierSpacing: 120, nodeSpacing: 20, canvasWidth: 800, canvasHeight: 600 };

  test('empty graph returns empty positions', () => {
    expect(autoLayout([], [], config).size).toBe(0);
  });

  test('single node at tier 0', () => {
    const positions = autoLayout([makeNode('a')], [], config);
    expect(positions.has('a')).toBe(true);
    expect(positions.get('a')?.y).toBeGreaterThanOrEqual(0);
  });

  test('top-down direction places nodes at increasing y per tier', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = autoLayout(nodes, edges, config);
    expect(positions.get('a')!.y).toBeLessThan(positions.get('b')!.y);
  });

  test('left-right direction places nodes at increasing x per tier', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const positions = autoLayout(nodes, edges, { ...config, direction: 'left-right' });
    expect(positions.get('a')!.x).toBeLessThan(positions.get('b')!.x);
  });

  test('grouped nodes sort adjacent within tier', () => {
    const nodes = [
      makeNode('n1', { name: 'Z', groupId: 'g1' }),
      makeNode('n2', { name: 'Y', groupId: 'g1' }),
      makeNode('n3', { name: 'X', groupId: '' }),
    ];
    const positions = autoLayout(nodes, [], config);
    // n3 (no group) should be at a different x than n1/n2 (same group)
    // The sort order within tier is: no-group first (alphabetical), then grouped
    // Actually it's alphabetical by groupId string, empty '' sorts first
    const x1 = positions.get('n1')!.x;
    const x2 = positions.get('n2')!.x;
    // Grouped nodes n1 and n2 should be rendered adjacent (no other node between them in x order)
    const xs = [positions.get('n1')!.x, positions.get('n2')!.x, positions.get('n3')!.x].sort((a, b) => a - b);
    // Confirm the 2 grouped-together nodes aren't separated by the ungrouped one
    const n3Idx = xs.indexOf(positions.get('n3')!.x);
    expect([0, 2]).toContain(n3Idx);
    // And basic sanity: x1 and x2 exist
    expect(typeof x1).toBe('number');
    expect(typeof x2).toBe('number');
  });

  test('auto-reduces tier spacing when topology is deep', () => {
    // 10-tier topology forces effectiveTierSpacing < config.tierSpacing to fit canvas.
    // Without reduction, 10 tiers × 120 spacing = 9 gaps × 120 = 1080 span.
    // With reduction, the algo floors max(60, (canvasHeight - 60) / tierCount) ≥ 60.
    const nodes = Array.from({ length: 10 }, (_, i) => makeNode(`n${i}`));
    const edges = nodes.slice(0, -1).map((n, i) => makeEdge(`e${i}`, n.id, nodes[i + 1].id));
    const smallConfig = { ...config, canvasHeight: 300 };
    const positions = autoLayout(nodes, edges, smallConfig);
    const firstY = positions.get('n0')!.y;
    const lastY = positions.get('n9')!.y;
    const span = lastY - firstY;
    // Should be strictly less than the un-reduced span (9 * 120 = 1080)
    expect(span).toBeLessThan(1080);
    // And >= floor(60 min spacing) * 9 gaps = 540
    expect(span).toBeGreaterThanOrEqual(540);
  });
});

describe('snapToGrid', () => {
  test('rounds to nearest grid multiple', () => {
    expect(snapToGrid(23, 47, 20)).toEqual({ x: 20, y: 40 });
  });

  test('already-on-grid coords stay unchanged', () => {
    expect(snapToGrid(40, 60, 20)).toEqual({ x: 40, y: 60 });
  });

  test('negative coords round correctly', () => {
    // Note: JS's Math.round can produce -0 for values that round to zero;
    // toBe uses Object.is which treats -0 !== 0, so normalise via value equality
    const result = snapToGrid(-17, -8, 20);
    expect(result.x).toBe(-20);
    // Use abs-equality for y to tolerate -0
    expect(Math.abs(result.y)).toBe(0);
  });
});
