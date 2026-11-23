'use server';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapActiveRoute } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { canViewMap } from '@/lib/auth/rights';
import type { MapActiveRouteView, RouteHop } from '@/types';
import { setMapActiveRouteInputSchema } from '@/lib/map/mapActiveRouteSchema';

export async function setMapActiveRouteAction(
  input: unknown,
): Promise<{ ok: true; data: MapActiveRouteView } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = setMapActiveRouteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid active route.' };
  const mapId = BigInt(parsed.data.mapId);
  if (!(await canViewMap(BigInt(session.characterId!), mapId))) {
    return { ok: false, error: 'No access.' };
  }

  const hops = parsed.data.plan.hops;
  const planJson = { hops, destinationSystemId: parsed.data.destinationSystemId };

  await db
    .delete(apMapActiveRoute)
    .where(and(eq(apMapActiveRoute.mapId, mapId), eq(apMapActiveRoute.ownerUserId, session.userId)));

  const [row] = await db
    .insert(apMapActiveRoute)
    .values({
      mapId,
      ownerUserId: session.userId,
      primaryCharacterId: BigInt(parsed.data.primaryCharacterId),
      destinationSystemId: parsed.data.destinationSystemId,
      planJson,
      followerCharacterIds: parsed.data.followerCharacterIds,
      waypointCursor: 0,
    })
    .returning();

  if (!row) return { ok: false, error: 'Could not save route.' };

  return {
    ok: true,
    data: {
      id: row.id.toString(),
      destinationSystemId: row.destinationSystemId,
      destinationName: parsed.data.plan.destinationName,
      followerCharacterIds: row.followerCharacterIds ?? [],
      waypointCursor: row.waypointCursor,
      hops: (row.planJson as { hops?: RouteHop[] }).hops ?? hops,
    },
  };
}

export async function clearMapActiveRouteAction(input: {
  mapId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!(await canViewMap(BigInt(session.characterId!), BigInt(input.mapId)))) {
    return { ok: false, error: 'No access.' };
  }
  await db
    .delete(apMapActiveRoute)
    .where(
      and(
        eq(apMapActiveRoute.mapId, BigInt(input.mapId)),
        eq(apMapActiveRoute.ownerUserId, session.userId),
      ),
    );
  return { ok: true };
}
