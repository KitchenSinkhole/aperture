'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apCharacter, apMap, apMapSystem, mapScope, mapType, tagScheme } from '@/db/schema';
import { requireSession } from '@/lib/session';
import type { InferInsertModel } from 'drizzle-orm';
import { commitMapEvent, type ActionResult } from '@/lib/map/mutations/core';
import type { MapEventPatch, MapEventPayload } from '@/lib/realtime/protocol';
import { applyHomeStaticExemption } from '@/lib/tagging/exemption';
import { canCreateMap, requireMapManage, requireMapRight } from '@/lib/auth/rights';
import { logger } from '@/lib/log/logger';

/**
 * Low-frequency, user-initiated map mutations via Server Actions (CLAUDE.md
 * mutation pathways: Server Actions for state changes where a fresh render is
 * the natural next step). Each one validates input, lands exactly one
 * `ap_map_event` through `commitMapEvent`, and revalidates the maps list.
 *
 * Access (derived authority — EVE state + ownership):
 *   - `createMapAction`         requires `canCreateMap(actor, type)`: private →
 *                               any active character; corp → a Director (owned to
 *                               the actor's corp); alliance → an executor-corp
 *                               Director (owned to the actor's alliance).
 *   - `updateMapSettingsAction` requires `canManageMap` (via `requireMapManage`).
 *   - `deleteMapAction`         requires `canManageMap` (via `requireMapRight`):
 *                               private owner, owning corp's Director, or the
 *                               owning alliance's executor-corp Director; admin
 *                               overrides everywhere.
 */

const createMapSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  scope: z.enum(mapScope.enumValues),
  type: z.enum(mapType.enumValues),
  icon: z.string().trim().max(100).nullish(),
});

const updateMapSettingsSchema = z.object({
  mapId: z.string().regex(/^\d+$/, 'Invalid map id.'),
  name: z.string().trim().min(1).max(100).optional(),
  icon: z.string().trim().max(100).nullish(),
  deleteExpiredConnections: z.boolean().optional(),
  deleteEolConnections: z.boolean().optional(),
  trackAbyssalJumps: z.boolean().optional(),
  logActivity: z.boolean().optional(),
  // Auto-tagging (gated by canManageMap, like the rest of the dialog).
  tagScheme: z.enum(tagScheme.enumValues).optional(),
  homeMapSystemId: z.string().regex(/^\d+$/, 'Invalid system id.').nullable().optional(),
  exemptHomeStaticFromTag: z.boolean().optional(),
});

export type CreateMapInput = z.input<typeof createMapSchema>;
export type UpdateMapSettingsInput = z.input<typeof updateMapSettingsSchema>;

/** Create a map. Emits `map.create`; the new map id is in `data.id`. */
export async function createMapAction(
  input: CreateMapInput,
): Promise<ActionResult<MapEventPayload>> {
  const session = await requireSession();
  const parsed = createMapSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { name, scope, type, icon } = parsed.data;

  const characterId = BigInt(session.characterId);
  if (!(await canCreateMap(characterId, type))) {
    return { ok: false, error: 'You do not have permission to create maps.' };
  }

  // Resolve the owner FK for the chosen scope. For corp/alliance the actor's
  // affiliation must be present — without an affiliation we have no entity to
  // hand ownership to.
  const [actor] = await db
    .select({
      corporationId: apCharacter.corporationId,
      allianceId: apCharacter.allianceId,
    })
    .from(apCharacter)
    .where(eq(apCharacter.id, characterId));

  let ownerCharacterId: bigint | null = null;
  let ownerCorporationId: bigint | null = null;
  let ownerAllianceId: bigint | null = null;
  switch (type) {
    case 'private':
      ownerCharacterId = characterId;
      break;
    case 'corp':
      if (!actor?.corporationId) {
        return { ok: false, error: 'Cannot create a corporation map without a corporation.' };
      }
      ownerCorporationId = actor.corporationId;
      break;
    case 'alliance':
      if (!actor?.allianceId) {
        return { ok: false, error: 'Cannot create an alliance map without an alliance.' };
      }
      ownerAllianceId = actor.allianceId;
      break;
  }

  // The map id is needed both as the event's `map_id` FK and in the payload, so
  // pre-allocate it from the sequence before the row is inserted (mirrors the
  // `eventId` pre-allocation in commitMapEvent). Sequences are non-transactional.
  const [seq] = (
    await db.execute(sql`SELECT nextval(pg_get_serial_sequence('ap_map', 'id')) AS id`)
  ).rows as Array<{ id: string }>;
  const mapId = BigInt(seq!.id);

  const result = await commitMapEvent({
    mapId,
    characterId,
    kind: 'map.create',
    mutate: async (tx) => {
      await tx.insert(apMap).values({
        id: mapId,
        name,
        scope,
        type,
        icon: icon ?? null,
        ownerCharacterId,
        ownerCorporationId,
        ownerAllianceId,
      });
      return { id: mapId.toString(), name, scope, type, icon: icon ?? null };
    },
  });

  if (result.ok) revalidatePath('/maps');
  return result;
}

/** Soft-delete a map (two-phase: set `deleted_at`, cron purges later). Emits `map.delete`. */
export async function deleteMapAction(mapId: string): Promise<ActionResult<MapEventPayload>> {
  const session = await requireSession();
  if (!/^\d+$/.test(mapId)) return { ok: false, error: 'Invalid map id.' };
  const id = BigInt(mapId);

  const guard = await requireMapRight(session, id, 'map_delete');
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

  const result = await commitMapEvent({
    mapId: id,
    characterId: guard.characterId,
    kind: 'map.delete',
    mutate: async (tx) => {
      const deletedAt = new Date();
      const [row] = await tx
        .update(apMap)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(eq(apMap.id, id), isNull(apMap.deletedAt)))
        .returning({ id: apMap.id });
      if (!row) throw new Error('Map not found or already deleted.');
      return { id: row.id.toString(), deletedAt: deletedAt.toISOString() };
    },
  });

  if (result.ok) revalidatePath('/maps');
  return result;
}

/** Update a map's name / icon / behavior flags. Emits `map.update` with only the changed fields. */
export async function updateMapSettingsAction(
  input: UpdateMapSettingsInput,
): Promise<ActionResult<MapEventPayload>> {
  const session = await requireSession();
  const parsed = updateMapSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { mapId, ...patch } = parsed.data;
  const id = BigInt(mapId);

  // Map settings are a management surface — gated by `canManageMap`, NOT the
  // now view-level `map_update` content-editing right.
  const guard = await requireMapManage(session, id);
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

  // Auto-tagging config (scheme + Home) rides the same `canManageMap` authority
  // as the rest of the dialog — no separate gate now that the corp-right matrix
  // is gone. `touchesTagging` only drives the Home-static exemption reconcile.
  const touchesTagging =
    'tagScheme' in patch || 'homeMapSystemId' in patch || 'exemptHomeStaticFromTag' in patch;

  const result = await commitMapEvent({
    mapId: id,
    characterId: guard.characterId,
    kind: 'map.update',
    mutate: async (tx) => {
      const set: Partial<InferInsertModel<typeof apMap>> = { updatedAt: new Date() };
      // Tagging fields persist but are deliberately NOT echoed in the `map.update`
      // payload — auto-tagging config propagates on next map load, not realtime.
      const out: MapEventPatch<'map.update'> = { id: id.toString() };
      if ('name' in patch) set.name = out.name = patch.name;
      if ('icon' in patch) set.icon = out.icon = patch.icon ?? null;
      if ('deleteExpiredConnections' in patch)
        set.deleteExpiredConnections = out.deleteExpiredConnections = patch.deleteExpiredConnections;
      if ('deleteEolConnections' in patch)
        set.deleteEolConnections = out.deleteEolConnections = patch.deleteEolConnections;
      if ('trackAbyssalJumps' in patch)
        set.trackAbyssalJumps = out.trackAbyssalJumps = patch.trackAbyssalJumps;
      if ('logActivity' in patch) set.logActivity = out.logActivity = patch.logActivity;
      if ('tagScheme' in patch) set.tagScheme = patch.tagScheme;
      if ('exemptHomeStaticFromTag' in patch)
        set.exemptHomeStaticFromTag = patch.exemptHomeStaticFromTag;
      if ('homeMapSystemId' in patch) {
        if (patch.homeMapSystemId != null) {
          const homeId = BigInt(patch.homeMapSystemId);
          const [home] = await tx
            .select({ id: apMapSystem.id })
            .from(apMapSystem)
            .where(
              and(
                eq(apMapSystem.id, homeId),
                eq(apMapSystem.mapId, id),
                eq(apMapSystem.visible, true),
              ),
            );
          if (!home) throw new Error('Home system is not on this map.');
          set.homeMapSystemId = homeId;
        } else {
          set.homeMapSystemId = null;
        }
      }

      const [row] = await tx
        .update(apMap)
        .set(set)
        .where(and(eq(apMap.id, id), isNull(apMap.deletedAt)))
        .returning({ id: apMap.id });
      if (!row) throw new Error('Map not found or deleted.');
      return out;
    },
  });

  // A tagging-config change can move the Home static target — reconcile the ABC
  // exemption as separate `system.update` events (after the settings commit, so
  // the reconcile reads the new config). No-op for non-ABC maps; failures here
  // must never fail the settings save.
  if (result.ok && touchesTagging) {
    try {
      await applyHomeStaticExemption(id, guard.characterId);
    } catch (err) {
      logger.warn('home-static exemption reconcile failed', { mapId: id.toString(), err });
    }
  }

  if (result.ok) revalidatePath('/maps');
  return result;
}
