import type { RouteHop } from '@/types';

function isJspaceHop(hop: RouteHop): boolean {
  return hop.securityStatus != null && hop.securityStatus < 0;
}

/**
 * ESI autopilot waypoints: k-space system ids only (J-space hops omitted).
 * The origin hop (`via: 'origin'`) is excluded — callers set the first waypoint separately.
 */
export function kspaceWaypointSystemIds(hops: RouteHop[]): number[] {
  const out: number[] = [];
  for (const hop of hops) {
    if (hop.via === 'origin') continue;
    if (!isJspaceHop(hop)) out.push(hop.systemId);
  }
  return out;
}
