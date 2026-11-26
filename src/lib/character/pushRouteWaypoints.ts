import { requestJson } from '@/lib/http/fetchJson';
import { kspaceWaypointSystemIds } from '@/lib/map/routeKspaceWaypoints';
import type { RouteHop } from '@/types';

export async function pushKspaceWaypointsForCharacter(
  characterId: number,
  hops: RouteHop[],
): Promise<{ ok: true; pushed: number } | { ok: false; error: string }> {
  const ids = kspaceWaypointSystemIds(hops);
  if (ids.length === 0) {
    return { ok: false, error: 'No k-space waypoints on this route.' };
  }
  const result = await requestJson<
    { ok: true; pushed: number } | { ok: false; error: string }
  >('POST', '/api/character/waypoint', {
    mode: 'sequence',
    characterId,
    waypointSystemIds: ids,
  });
  return result;
}
