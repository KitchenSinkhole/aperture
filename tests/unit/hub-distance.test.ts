import { describe, expect, it } from 'vitest';
import { nearestHubOnGraph } from '@/lib/map/hubDistance';

/**
 * The multi-source BFS behind the spectator view's "N jumps from <hub>" line.
 * Unlike `universe_system.nearest_trade_hub_jumps`, it runs on the unrestricted
 * gate graph, so low- and null-sec entrances resolve too.
 */

const HUB_A = { systemId: 1, name: 'Alpha' };
const HUB_B = { systemId: 2, name: 'Bravo' };

/** Undirected adjacency from a list of edges. */
function graph(edges: [number, number][]): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  for (const [a, b] of edges) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }
  return adjacency;
}

describe('nearestHubOnGraph', () => {
  it('reports a hub as zero jumps from itself', () => {
    const dist = nearestHubOnGraph(graph([[1, 10]]), [HUB_A]);
    expect(dist.get(1)).toEqual({ name: 'Alpha', jumps: 0 });
  });

  it('counts gate jumps outward from a single hub', () => {
    const dist = nearestHubOnGraph(
      graph([
        [1, 10],
        [10, 11],
        [11, 12],
      ]),
      [HUB_A],
    );
    expect(dist.get(10)).toEqual({ name: 'Alpha', jumps: 1 });
    expect(dist.get(11)).toEqual({ name: 'Alpha', jumps: 2 });
    expect(dist.get(12)).toEqual({ name: 'Alpha', jumps: 3 });
  });

  it('attributes each system to whichever hub is nearest, not the first one listed', () => {
    // 1 —10—11—12— 2 : 10 belongs to Alpha, 12 to Bravo, 11 ties to Alpha.
    const dist = nearestHubOnGraph(
      graph([
        [1, 10],
        [10, 11],
        [11, 12],
        [12, 2],
      ]),
      [HUB_A, HUB_B],
    );
    expect(dist.get(10)).toEqual({ name: 'Alpha', jumps: 1 });
    expect(dist.get(12)).toEqual({ name: 'Bravo', jumps: 1 });
    expect(dist.get(11)!.jumps).toBe(2);
  });

  it('takes the shorter of two routes to the same system', () => {
    const dist = nearestHubOnGraph(
      graph([
        [1, 10],
        [10, 20],
        [1, 30],
        [30, 31],
        [31, 20],
      ]),
      [HUB_A],
    );
    expect(dist.get(20)).toEqual({ name: 'Alpha', jumps: 2 });
  });

  it('omits systems on a gate network disjoint from every hub', () => {
    const dist = nearestHubOnGraph(
      graph([
        [1, 10],
        [90, 91],
      ]),
      [HUB_A],
    );
    expect(dist.has(90)).toBe(false);
    expect(dist.has(91)).toBe(false);
  });

  it('imposes no distance cap, unlike the high-sec proximity precompute', () => {
    const chain: [number, number][] = [[1, 100]];
    for (let i = 100; i < 140; i++) chain.push([i, i + 1]);
    const dist = nearestHubOnGraph(graph(chain), [HUB_A]);
    expect(dist.get(140)).toEqual({ name: 'Alpha', jumps: 41 });
  });
});
