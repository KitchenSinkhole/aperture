'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apMap, apMapSystem, tagScheme } from '@/db/schema';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/auth/rights';
import { commitMapEvent, type ActionResult } from '@/lib/map/mutations/core';
import type { MapEventPatch, MapEventPayload } from '@/lib/realtime/protocol';
import { applyHomeStaticExemption } from '@/lib/tagging/exemption';
import { logger } from '@/lib/log/logger';

/**
 * Admin map actions — the `/admin` operator's cross-tenant oversight surface,
 * gated `isAdmin` (global operator only). Corp Directors / owners manage their
 * own maps in-place via `canManageMap`, not here.
 *
 *   - `adminSoftDeleteMap`      admin → sets `deleted_at`.
 *   - `adminRestoreMap`         admin → clears `deleted_at`.
 *   - `adminPurgeMap`           admin → hard-deletes (skips the 30-day
 *                               `map-purge` cron grace).
 *   - `adminUpdateMapSettings`  admin → updates behavior toggles and
 *                               auto-tagging config (map.update event).
 *
 * No per-map scoping — admin reaches every map.
 */

const mapIdSchema = z.string().regex(/^\d+$/, 'Invalid map id.');

type MapRow = {
  id: bigint;
  deletedAt: Date | null;
};

async function selectMap(id: bigint): Promise<MapRow | null> {
  const [row] = await db
    .select({ id: apMap.id, deletedAt: apMap.deletedAt })
    .from(apMap)
    .where(eq(apMap.id, id));
  return row ?? null;
}

/**
 * Soft-delete a map: set `deleted_at = now()`. Mirrors the user
 * `deleteMapAction` outcome (same event kind, same payload shape) under the
 * operator's `isAdmin` gate. The 30-day `map-purge` cron remains the eventual
 * hard-delete path.
 */
export async function adminSoftDeleteMap(
  mapId: string,
): Promise<ActionResult<MapEventPayload>> {
  const parsed = mapIdSchema.safeParse(mapId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const session = await auth();
  if (!(await isAdmin(session))) {
    return { ok: false, error: 'Forbidden.' };
  }
  const id = BigInt(parsed.data);
  const target = await selectMap(id);
  if (target === null) return { ok: false, error: 'Map not found.' };
  if (target.deletedAt !== null) return { ok: false, error: 'Map is already soft-deleted.' };

  const characterId = session!.characterId ? BigInt(session!.characterId) : null;
  const result = await commitMapEvent({
    mapId: id,
    characterId,
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

  if (result.ok) {
    revalidatePath('/admin/maps');
    revalidatePath('/maps');
  }
  return result;
}

/**
 * Restore a soft-deleted map by clearing `deleted_at`. Emits
 * `map.restore` so the audit chain records the action. Admin only.
 */
export async function adminRestoreMap(
  mapId: string,
): Promise<ActionResult<MapEventPayload>> {
  const parsed = mapIdSchema.safeParse(mapId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const session = await auth();
  if (!(await isAdmin(session))) {
    return { ok: false, error: 'Forbidden.' };
  }
  const id = BigInt(parsed.data);
  const target = await selectMap(id);
  if (target === null) return { ok: false, error: 'Map not found.' };
  if (target.deletedAt === null) return { ok: false, error: 'Map is not soft-deleted.' };

  const characterId = session!.characterId ? BigInt(session!.characterId) : null;
  const result = await commitMapEvent({
    mapId: id,
    characterId,
    kind: 'map.restore',
    mutate: async (tx) => {
      const [row] = await tx
        .update(apMap)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(and(eq(apMap.id, id), isNotNull(apMap.deletedAt)))
        .returning({ id: apMap.id });
      if (!row) throw new Error('Map is not soft-deleted.');
      return { id: row.id.toString() };
    },
  });

  if (result.ok) {
    revalidatePath('/admin/maps');
    revalidatePath('/maps');
  }
  return result;
}

const adminMapSettingsSchema = z.object({
  mapId: z.string().regex(/^\d+$/, 'Invalid map id.'),
  deleteExpiredConnections: z.boolean().optional(),
  deleteEolConnections: z.boolean().optional(),
  trackAbyssalJumps: z.boolean().optional(),
  logActivity: z.boolean().optional(),
  tagScheme: z.enum(tagScheme.enumValues).optional(),
  homeMapSystemId: z.string().regex(/^\d+$/).nullable().optional(),
  exemptHomeStaticFromTag: z.boolean().optional(),
});

export type AdminUpdateMapSettingsInput = z.input<typeof adminMapSettingsSchema>;

/**
 * Update a map's behavior toggles and/or auto-tagging config from the admin
 * panel. Gated by `isAdmin`. Emits `map.update` (same event kind as the
 * user-facing `updateMapSettingsAction`). Reconciles the ABC home-static
 * exemption after any tagging-config change.
 */
export async function adminUpdateMapSettings(
  input: AdminUpdateMapSettingsInput,
): Promise<ActionResult<MapEventPayload>> {
  const parsed = adminMapSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { mapId: rawId, ...patch } = parsed.data;
  const id = BigInt(rawId);

  const session = await auth();
  if (!(await isAdmin(session))) {
    return { ok: false, error: 'Forbidden.' };
  }

  const target = await selectMap(id);
  if (target === null) return { ok: false, error: 'Map not found.' };
  if (target.deletedAt !== null) return { ok: false, error: 'Map is soft-deleted.' };

  const characterId = session?.characterId ? BigInt(session.characterId) : null;
  const touchesTagging =
    'tagScheme' in patch || 'homeMapSystemId' in patch || 'exemptHomeStaticFromTag' in patch;

  const result = await commitMapEvent({
    mapId: id,
    characterId,
    kind: 'map.update',
    mutate: async (tx) => {
      const set: Partial<InferInsertModel<typeof apMap>> = { updatedAt: new Date() };
      const out: MapEventPatch<'map.update'> = { id: id.toString() };

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

  if (result.ok && touchesTagging) {
    try {
      await applyHomeStaticExemption(id, characterId);
    } catch (err) {
      logger.warn('home-static exemption reconcile failed', { mapId: id.toString(), err });
    }
  }

  if (result.ok) {
    revalidatePath('/admin/maps');
    revalidatePath('/maps');
  }
  return result;
}

/**
 * Admin-only: hard-delete a soft-deleted map immediately, skipping
 * the 30-day `map-purge` cron grace.
 *
 * Transaction ordering matters: the `map.purge` event INSERTs first so the
 * `tg_map_event_notify` trigger queues the `pg_notify('map:<id>', payload)`.
 * The subsequent `ap_map` DELETE cascades through `ap_map_event` (incl. the
 * row we just inserted) and every other per-map child table. Postgres buffers
 * notifications until COMMIT, so subscribers still receive the purge envelope
 * even though the source row is gone. The `commitMapEvent({ tx })` joined-tx
 * mode skips its post-commit webhook enqueue, which is correct — no map to
 * dispatch about post-commit.
 */
export async function adminPurgeMap(
  mapId: string,
): Promise<ActionResult<MapEventPayload>> {
  const parsed = mapIdSchema.safeParse(mapId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const session = await auth();
  if (!(await isAdmin(session))) {
    return { ok: false, error: 'Admin required.' };
  }
  const id = BigInt(parsed.data);
  const target = await selectMap(id);
  if (target === null) return { ok: false, error: 'Map not found.' };
  if (target.deletedAt === null) {
    return { ok: false, error: 'Map must be soft-deleted before purging.' };
  }

  const characterId = session!.characterId ? BigInt(session!.characterId) : null;
  try {
    const eventId = await db.transaction(async (tx) => {
      const inner = await commitMapEvent({
        tx,
        mapId: id,
        characterId,
        kind: 'map.purge',
        mutate: async () => ({ id: id.toString() }),
      });
      if (!inner.ok) throw new Error(inner.error);
      const result = await tx
        .delete(apMap)
        .where(eq(apMap.id, id))
        .returning({ id: apMap.id });
      if (result.length === 0) throw new Error('Map vanished mid-purge.');
      return inner.eventId;
    });
    revalidatePath('/admin/maps');
    return {
      ok: true,
      data: { kind: 'map.purge', eventId, id: id.toString() },
      eventId,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Purge failed.' };
  }
}

