'use server';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapActiveRoute, universeSystem } from '@/db/schema';
import { requireSession, assertCharacterOwnership } from '@/lib/session';
import { canViewMap } from '@/lib/auth/rights';
import type { MapActiveRouteView, RouteHop } from '@/types';
import {
  clearMapActiveRouteInputSchema,
  setMapActiveRouteInputSchema,
} from '@/lib/map/mapActiveRouteSchema';

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

  const primaryId = BigInt(parsed.data.primaryCharacterId);
  if (!(await assertCharacterOwnership(primaryId, session.userId))) {
    return { ok: false, error: 'Character not found.' };
  }
  for (const followerId of parsed.data.followerCharacterIds) {
    if (!(await assertCharacterOwnership(BigInt(followerId), session.userId))) {
      return { ok: false, error: 'Character not found.' };
    }
  }

  const [destSystem] = await db
    .select({ id: universeSystem.id })
    .from(universeSystem)
    .where(eq(universeSystem.id, parsed.data.destinationSystemId));
  if (!destSystem) return { ok: false, error: 'No such system.' };

  const hops = parsed.data.plan.hops;
  const planJson = { hops, destinationSystemId: parsed.data.destinationSystemId };
  const now = new Date();

  const [row] = await db
    .insert(apMapActiveRoute)
    .values({
      mapId,
      ownerUserId: session.userId,
      primaryCharacterId: primaryId,
      destinationSystemId: parsed.data.destinationSystemId,
      planJson,
      followerCharacterIds: parsed.data.followerCharacterIds,
      waypointCursor: 0,
    })
    .onConflictDoUpdate({
      target: [apMapActiveRoute.mapId, apMapActiveRoute.ownerUserId],
      set: {
        primaryCharacterId: primaryId,
        destinationSystemId: parsed.data.destinationSystemId,
        planJson,
        followerCharacterIds: parsed.data.followerCharacterIds,
        waypointCursor: 0,
        updatedAt: now,
      },
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
  const parsed = clearMapActiveRouteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid active route.' };
  if (!(await canViewMap(BigInt(session.characterId!), BigInt(parsed.data.mapId)))) {
    return { ok: false, error: 'No access.' };
  }
  await db
    .delete(apMapActiveRoute)
    .where(
      and(
        eq(apMapActiveRoute.mapId, BigInt(parsed.data.mapId)),
        eq(apMapActiveRoute.ownerUserId, session.userId),
      ),
    );
  return { ok: true };
}