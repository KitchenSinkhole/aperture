import 'server-only';
import { apertureConfig } from '../../../aperture.config';
import { getGateGraph } from './routePlanner';

/**
 * Unrestricted gate-jump distance from every system to its nearest major trade
 * hub.
 *
 * Distinct from `universe_system.nearest_trade_hub_jumps`, which is a
 * high-sec-only subgraph capped at each hub's `proximityJumps` radius and is
 * therefore null for low-sec, null-sec, and distant high-sec systems. This pass
 * traverses the full stargate graph, so every gate-connected system resolves.
 * The route it measures makes no safety claim — it is the shortest path, not a
 * high-sec one.
 */

export type HubDistance = { name: string; jumps: number };

let hubDistancePromise: Promise<Map<number, HubDistance>> | null = null;

/**
 * Nearest-hub jump distance for every gate-connected system, memoized for the
 * process lifetime (the stargate graph is static SDE data).
 *
 * Systems on a gate network disjoint from all five hubs (isolated Pochven,
 * Zarzakh, wormhole space) are absent from the map.
 */
export function nearestHubJumps(): Promise<Map<number, HubDistance>> {
  if (!hubDistancePromise) hubDistancePromise = computeNearestHubJumps();
  return hubDistancePromise;
}

async function computeNearestHubJumps(): Promise<Map<number, HubDistance>> {
  const { adjacency } = await getGateGraph();
  return nearestHubOnGraph(adjacency, apertureConfig.ROUTE_HUBS);
}

/**
 * Multi-source BFS seeded with every hub at distance 0, each visit carrying the
 * hub it descends from. Because BFS visits in non-decreasing distance order, the
 * first visit to a system is by definition from its nearest hub, so one pass
 * answers for every hub rather than one pass each plus a minimum. Where two hubs
 * tie, the one earlier in `hubs` wins.
 *
 * Pure and DB-free, so the unit tests drive it directly.
 */
export function nearestHubOnGraph(
  adjacency: Map<number, number[]>,
  hubs: readonly { systemId: number; name: string }[],
): Map<number, HubDistance> {
  const dist = new Map<number, HubDistance>();
  const queue: number[] = [];

  for (const hub of hubs) {
    if (dist.has(hub.systemId)) continue;
    dist.set(hub.systemId, { name: hub.name, jumps: 0 });
    queue.push(hub.systemId);
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    const entry = dist.get(current)!;
    for (const next of adjacency.get(current) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, { name: entry.name, jumps: entry.jumps + 1 });
      queue.push(next);
    }
  }

  return dist;
}

/** Test seam: drops the memoized graph so the next call recomputes. */
export function __resetHubDistanceCache(): void {
  hubDistancePromise = null;
}
