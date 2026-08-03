import 'server-only';
import type { PublicMapConnectionEdge, PublicMapSystemNode } from './loadPublicMap';
import { nearestHubJumps } from './hubDistance';

/**
 * The k-space ways into a publicly-shared chain, derived server-side so the
 * spectator view never has to infer them from the payload (design invariant 1).
 */

/** `universe_system.security` labels that denote gate-connected k-space. */
const KSPACE_SECURITY = new Set(['H', 'L', '0.0', 'P']);

/** One wormhole jump along the way from a k-space entrance to the map's Home. */
export type PublicMapEntranceHop = {
  /** `ap_map_connection.id` of the hole to jump, as a string. */
  connectionId: string;
  /** Code to scan in the system you are standing in; null when unknown or the token withholds codes. */
  sigId: string | null;
  /** `ap_map_system.id` you arrive in, matching a node id on the canvas. */
  mapSystemId: string;
  /** EVE solar-system id you arrive in. */
  systemId: number;
  /** Name of the system you arrive in. */
  name: string;
  /** Security label of the arrival system, e.g. `C5`. */
  security: string | null;
  /** The operator's short tag for the arrival system, e.g. `VFD`; null when untagged. */
  tag: string | null;
};

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
   * Hop-by-hop way from this k-space system to the map's Home, starting with
   * this entrance hole itself; null when this hole does not lead home. One
   * k-space system holding two holes can have one that leads home and one
   * that leads elsewhere, and for a guest those are opposite directions.
   */
  pathHome: PublicMapEntranceHop[] | null;
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
      const sigId = c.sigIds?.[side] ?? null;
      const rest =
        homeMapSystemId !== null && far !== undefined
          ? pathTo(far.id, homeMapSystemId, system.id, adjacency)
          : null;
      entrances.push({
        connectionId: c.id,
        mapSystemId: system.id,
        systemId: system.systemId,
        name: system.name,
        security: system.security,
        trueSec: system.trueSec,
        regionName: system.regionName,
        sigId,
        farSigId: c.sigIds?.[side === 'source' ? 'target' : 'source'] ?? null,
        leadsTo: far?.security ?? null,
        pathHome:
          rest !== null && far !== undefined
            ? [
                {
                  connectionId: c.id,
                  sigId,
                  mapSystemId: far.id,
                  systemId: far.systemId,
                  name: far.name,
                  security: far.security,
                  tag: far.tag,
                },
                ...rest.map((step) => toHop(step, byId)),
              ]
            : null,
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

/** One step of undirected map-system adjacency, carrying the connection that made it. */
type AdjacencyStep = { to: string; connection: PublicMapConnectionEdge };

/** Undirected map-system adjacency over every connection, keyed by `ap_map_system.id`. */
function buildAdjacency(connections: PublicMapConnectionEdge[]): Map<string, AdjacencyStep[]> {
  const adjacency = new Map<string, AdjacencyStep[]>();
  for (const c of connections) {
    adjacency.set(c.source, [...(adjacency.get(c.source) ?? []), { to: c.target, connection: c }]);
    adjacency.set(c.target, [...(adjacency.get(c.target) ?? []), { to: c.source, connection: c }]);
  }
  return adjacency;
}

/** One jump reconstructed from a BFS path: the connection, the system departed from, and the system arrived in. */
type PathStep = { connectionId: string; from: string; to: string; connection: PublicMapConnectionEdge };

/**
 * Shortest hop-by-hop way from `from` to `target` without routing through
 * `excluded`, or null when unreachable. Excluding the k-space system the guest
 * is standing in is what separates "this hole goes home" from "home is merely
 * elsewhere on the map, back out this way".
 */
function pathTo(
  from: string,
  target: string,
  excluded: string,
  adjacency: Map<string, AdjacencyStep[]>,
): PathStep[] | null {
  if (from === excluded) return null;
  const cameFrom = new Map<string, AdjacencyStep>();
  const seen = new Set([excluded, from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === target) {
      return reconstructPath(from, current, cameFrom);
    }
    for (const step of adjacency.get(current) ?? []) {
      if (seen.has(step.to)) continue;
      seen.add(step.to);
      cameFrom.set(step.to, { to: current, connection: step.connection });
      queue.push(step.to);
    }
  }
  return null;
}

/** Walks `cameFrom` predecessor pointers back from `target` to `from`, in travel order. */
function reconstructPath(
  from: string,
  target: string,
  cameFrom: Map<string, AdjacencyStep>,
): PathStep[] {
  const steps: PathStep[] = [];
  for (let node = target; node !== from; ) {
    const step = cameFrom.get(node)!;
    steps.unshift({ connectionId: step.connection.id, from: step.to, to: node, connection: step.connection });
    node = step.to;
  }
  return steps;
}

/**
 * Converts a reconstructed path step into a published hop: the sig to scan is
 * read off the connection using the departure system's side, since that is
 * the code visible standing in the system before the jump.
 */
function toHop(step: PathStep, byId: Map<string, PublicMapSystemNode>): PublicMapEntranceHop {
  const arrival = byId.get(step.to);
  const side = step.connection.source === step.from ? 'source' : 'target';
  return {
    connectionId: step.connectionId,
    sigId: step.connection.sigIds?.[side] ?? null,
    mapSystemId: step.to,
    systemId: arrival?.systemId ?? 0,
    name: arrival?.name ?? '',
    security: arrival?.security ?? null,
    tag: arrival?.tag ?? null,
  };
}
