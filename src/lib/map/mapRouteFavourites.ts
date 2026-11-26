import 'server-only';
import { and, eq, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapRouteFavourite, universeSystem } from '@/db/schema';
import type { MapRouteFavouriteView } from '@/types';

export async function loadMapRouteFavourites(
  mapId: bigint,
  viewerUserId: number,
): Promise<MapRouteFavouriteView[]> {
  const rows = await db
    .select({
      id: apMapRouteFavourite.id,
      systemId: apMapRouteFavourite.systemId,
      label: apMapRouteFavourite.label,
      shared: apMapRouteFavourite.shared,
      userId: apMapRouteFavourite.userId,
      name: universeSystem.name,
      security: universeSystem.security,
    })
    .from(apMapRouteFavourite)
    .innerJoin(universeSystem, eq(apMapRouteFavourite.systemId, universeSystem.id))
    .where(
      and(
        eq(apMapRouteFavourite.mapId, mapId),
        or(eq(apMapRouteFavourite.userId, viewerUserId), eq(apMapRouteFavourite.shared, true)),
      ),
    );
  return rows.map((r) => ({
    id: r.id.toString(),
    systemId: r.systemId,
    name: r.name,
    security: r.security,
    label: r.label,
    shared: r.shared,
    ownedByViewer: r.userId === viewerUserId,
  }));
}
