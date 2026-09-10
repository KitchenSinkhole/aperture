import type { MapConnectionEdge, MapSystemNode } from '@/types';

/** How long a buffered jump waits for its `connection.create` before it's forgotten. */
export const BUFFER_TTL_MS = 3000;

export type TransitResolution =
  | { kind: 'resolved'; here: MapSystemNode; cameFrom: MapSystemNode; connection: MapConnectionEdge }
  | { kind: 'drop' }
  | { kind: 'pending' };

/**
 * Resolve one pilot jump against current map state to the `wh` connection it
 * crossed. `drop` = a gate link between the two systems (never a wormhole
 * transit); `pending` = the fold (systems/connection) hasn't reached client
 * state yet, so the caller should keep waiting. Reads only its arguments.
 */
export function resolveTransit(
  jump: { fromSystemId: number; toSystemId: number },
  systems: MapSystemNode[],
  connections: MapConnectionEdge[],
): TransitResolution {
  const source = systems.find((s) => s.systemId === jump.fromSystemId);
  const dest = systems.find((s) => s.systemId === jump.toSystemId);
  if (!source || !dest) return { kind: 'pending' };
  const incident = connections.filter(
    (c) =>
      (c.source === source.id && c.target === dest.id) ||
      (c.source === dest.id && c.target === source.id),
  );
  if (incident.some((c) => c.scope === 'stargate')) return { kind: 'drop' };
  const wh = incident.find((c) => c.scope === 'wh');
  if (!wh) return { kind: 'pending' };
  return { kind: 'resolved', here: dest, cameFrom: source, connection: wh };
}
