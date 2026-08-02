import 'server-only';
import type { PublicMapConnectionEdge, PublicMapSystemNode } from './loadPublicMap';
import { nearestHubJumps } from './hubDistance';

/**
 * The k-space ways into a publicly-shared chain, derived server-side so the
 * spectator view never has to infer them from the payload (design invariant 1).
 */

/** `universe_system.security` labels that denote gate-connected k-space. */
const KSPACE_SECURITY = new Set(['H', 'L', '0.0', 'P']);

/**
 * One mapped wormhole leading into the chain from k-space. A single k-space
 * system with two holes into the chain yields two rows — they are two separate
 * sets of directions.
 */
export type PublicMapEntrance = {
  /** `ap_map_connection.id` of the wormhole, as a string. Identifies the row. */
  connectionId: string;
  /** `ap_map_system.id` of the k-space side, matching a node id on the canvas. */
  mapSystemId: string;
  systemId: number;
  name: string;
  security: string | null;
  trueSec: number | null;
  regionName: string;
  /** Sig to scan in this k-space system; null when unknown or the token withholds codes. */
  sigId: string | null;
  /** The code on the far side, inside the chain; null when unknown or withheld. */
  farSigId: string | null;
  /** Security label of the system on the far side, e.g. `C5`. */
  leadsTo: string | null;
  /**
   * Whether jumping this hole reaches the map's Home without coming back out
   * through this same k-space system. One k-space system holding two holes can
   * have one that leads to the chain's home and one that leads elsewhere, and
   * for a guest those are opposite directions.
   */
  leadsHome: boolean;
  /** Shortest gate path to the nearest hub — no safety claim. Null when unreachable. */
  route: { hubName: string; jumps: number } | null;
};

/**
 * Every visible k-space system carrying at least one `wh` connection, paired
 * with the code to scan there and the gate distance to reach it.
 *
 * Ordered nearest-hub-first with unreachable systems last, so the closest way
 * in reads at the top of the board.
 */
export async function derivePublicEntrances(
  systems: PublicMapSystemNode[],
  connections: PublicMapConnectionEdge[],
  homeMapSystemId: string | null,
): Promise<PublicMapEntrance[]> {
  const kspace = new Map(
    systems.filter((s) => s.security != null && KSPACE_SECURITY.has(s.security)).map((s) => [s.id, s]),
  );
  if (kspace.size === 0) return [];

  const byId = new Map(systems.map((s) => [s.id, s]));
  const adjacency = buildAdjacency(connections);
  const hubs = await nearestHubJumps();
  const entrances: PublicMapEntrance[] = [];

  for (const c of connections) {
    if (c.scope !== 'wh') continue;
    for (const side of ['source', 'target'] as const) {
      const system = kspace.get(c[side]);
      if (!system) continue;
      const far = byId.get(side === 'source' ? c.target : c.source);
      const hub = hubs.get(system.systemId);
      entrances.push({
        connectionId: c.id,
        mapSystemId: system.id,
        systemId: system.systemId,
        name: system.name,
        security: system.security,
        trueSec: system.trueSec,
        regionName: system.regionName,
        sigId: c.sigIds?.[side] ?? null,
        farSigId: c.sigIds?.[side === 'source' ? 'target' : 'source'] ?? null,
        leadsTo: far?.security ?? null,
        leadsHome:
          homeMapSystemId !== null &&
          far !== undefined &&
          reaches(far.id, homeMapSystemId, system.id, adjacency),
        route: hub ? { hubName: hub.name, jumps: hub.jumps } : null,
      });
    }
  }

  return entrances.sort(
    (a, b) =>
      (a.route?.jumps ?? Number.MAX_SAFE_INTEGER) - (b.route?.jumps ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );
}

/** Undirected map-system adjacency over every connection, keyed by `ap_map_system.id`. */
function buildAdjacency(connections: PublicMapConnectionEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const c of connections) {
    adjacency.set(c.source, [...(adjacency.get(c.source) ?? []), c.target]);
    adjacency.set(c.target, [...(adjacency.get(c.target) ?? []), c.source]);
  }
  return adjacency;
}

/**
 * Whether `target` is reachable from `from` without routing through `excluded`.
 * Excluding the k-space system the guest is standing in is what separates "this
 * hole goes home" from "home is merely elsewhere on the map, back out this way".
 */
function reaches(
  from: string,
  target: string,
  excluded: string,
  adjacency: Map<string, string[]>,
): boolean {
  if (from === excluded) return false;
  const seen = new Set([excluded, from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === target) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}
