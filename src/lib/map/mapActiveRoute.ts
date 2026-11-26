import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapActiveRoute, universeSystem } from '@/db/schema';
import type { MapActiveRouteView, RouteHop } from '@/types';

export async function loadMapActiveRouteForUser(
  mapId: bigint,
  ownerUserId: number,
): Promise<MapActiveRouteView | null> {
  const [row] = await db
    .select({
      id: apMapActiveRoute.id,
      destinationSystemId: apMapActiveRoute.destinationSystemId,
      followerCharacterIds: apMapActiveRoute.followerCharacterIds,
      waypointCursor: apMapActiveRoute.waypointCursor,
      planJson: apMapActiveRoute.planJson,
      name: universeSystem.name,
    })
    .from(apMapActiveRoute)
    .innerJoin(universeSystem, eq(apMapActiveRoute.destinationSystemId, universeSystem.id))
    .where(and(eq(apMapActiveRoute.mapId, mapId), eq(apMapActiveRoute.ownerUserId, ownerUserId)))
    .limit(1);
  if (!row) return null;
  const plan = row.planJson as { hops?: RouteHop[] };
  return {
    id: row.id.toString(),
    destinationSystemId: row.destinationSystemId,
    destinationName: row.name,
    followerCharacterIds: row.followerCharacterIds ?? [],
    waypointCursor: row.waypointCursor,
    hops: plan.hops ?? [],
  };
}
