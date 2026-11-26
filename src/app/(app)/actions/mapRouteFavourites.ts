'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apMapRouteFavourite, universeSystem } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { canViewMap } from '@/lib/auth/rights';
import type { MapRouteFavouriteView } from '@/types';

const numericId = z.string().regex(/^\d+$/, 'Invalid id.');

const pinSchema = z.object({
  mapId: numericId,
  systemId: z.number().int().positive(),
  label: z.string().trim().max(60).nullish(),
  shared: z.boolean().optional(),
});

const removeFavouriteInputSchema = z.object({
  mapId: numericId,
  favouriteId: numericId,
});

export async function addMapRouteFavouriteAction(
  input: unknown,
): Promise<{ ok: true; data: MapRouteFavouriteView } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid favourite.' };
  const mapId = BigInt(parsed.data.mapId);
  if (!(await canViewMap(BigInt(session.characterId!), mapId))) return { ok: false, error: 'No access.' };

  const [system] = await db
    .select({ id: universeSystem.id, name: universeSystem.name, security: universeSystem.security })
    .from(universeSystem)
    .where(eq(universeSystem.id, parsed.data.systemId));
  if (!system) return { ok: false, error: 'No such system.' };

  const [row] = await db
    .insert(apMapRouteFavourite)
    .values({
      mapId,
      userId: session.userId,
      systemId: parsed.data.systemId,
      label: parsed.data.label ?? null,
      shared: parsed.data.shared ?? false,
    })
    .onConflictDoUpdate({
      target: [apMapRouteFavourite.mapId, apMapRouteFavourite.userId, apMapRouteFavourite.systemId],
      set: { label: parsed.data.label ?? null, shared: parsed.data.shared ?? false },
    })
    .returning({ id: apMapRouteFavourite.id });

  return {
    ok: true,
    data: {
      id: row!.id.toString(),
      systemId: system.id,
      name: system.name,
      security: system.security,
      label: parsed.data.label ?? null,
      shared: parsed.data.shared ?? false,
      ownedByViewer: true,
    },
  };
}

export async function removeMapRouteFavouriteAction(input: {
  mapId: string;
  favouriteId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = removeFavouriteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid favourite.' };
  if (!(await canViewMap(BigInt(session.characterId!), BigInt(parsed.data.mapId)))) return {
    ok: false,
    error: 'No access.',
  };
  await db
    .delete(apMapRouteFavourite)
    .where(
      and(
        eq(apMapRouteFavourite.id, BigInt(parsed.data.favouriteId)),
        eq(apMapRouteFavourite.mapId, BigInt(parsed.data.mapId)),
        eq(apMapRouteFavourite.userId, session.userId),
      ),
    );
  return { ok: true };
}
