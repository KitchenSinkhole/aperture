import type { MapConnectionEdge, MapPresenceEntry, RouteHop } from '@/types';

/** EVE system ids on the stored hop list. */
export function activeRouteHopSystemIds(hops: RouteHop[]): Set<number> {
  return new Set(hops.map((h) => h.systemId));
}

export function isOnActiveRoute(hops: RouteHop[], systemId: number): boolean {
  return activeRouteHopSystemIds(hops).has(systemId);
}

/**
 * First hop index for the remaining leg: at least `waypointCursor`, and at the
 * primary pilot's current system when they are on the stored path.
 */
export function activeRouteProgressIndex(
  hops: RouteHop[],
  waypointCursor: number,
  currentSystemId: number | null,
): number {
  if (hops.length === 0) return 0;
  const idx = Math.min(Math.max(0, waypointCursor), hops.length - 1);
  if (currentSystemId == null) return idx;
  let onPath = -1;
  for (let i = 0; i < hops.length; i++) {
    if (hops[i]!.systemId === currentSystemId) onPath = i;
  }
  if (onPath >= idx) return onPath;
  return idx;
}

export function remainingActiveRouteHops(
  hops: RouteHop[],
  waypointCursor: number,
  currentSystemId: number | null,
): RouteHop[] {
  return hops.slice(activeRouteProgressIndex(hops, waypointCursor, currentSystemId));
}

/** `ap_map_connection.id` strings referenced by wormhole hops. */
export function activeRouteConnectionIds(hops: RouteHop[]): string[] {
  const out: string[] = [];
  for (const h of hops) {
    if (h.connectionId == null) continue;
    const id = String(h.connectionId);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function followersOffRoute(
  hops: RouteHop[],
  presence: MapPresenceEntry[],
  followerCharacterIds: number[],
): { characterId: number; characterName: string; systemId: number }[] {
  const onRoute = activeRouteHopSystemIds(hops);
  const follow = new Set(followerCharacterIds);
  const out: { characterId: number; characterName: string; systemId: number }[] = [];
  for (const p of presence) {
    if (!follow.has(p.characterId)) continue;
    if (onRoute.has(p.systemId)) continue;
    out.push({
      characterId: p.characterId,
      characterName: p.characterName,
      systemId: p.systemId,
    });
  }
  return out;
}

export function routeConnectionsById(
  hops: RouteHop[],
  connections: MapConnectionEdge[],
): Map<string, MapConnectionEdge> {
  const ids = new Set(activeRouteConnectionIds(hops));
  const map = new Map<string, MapConnectionEdge>();
  for (const c of connections) {
    if (ids.has(c.id)) map.set(c.id, c);
  }
  return map;
}
