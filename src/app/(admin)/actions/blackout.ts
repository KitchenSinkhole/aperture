'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apAccessGrant, apCharacter, apCorporation, apInstance, apRole } from '@/db/schema';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/auth/rights';
import { clearPublicSnapshots } from '@/lib/map/publicSnapshot';
import type { BlackoutPanelData } from '@/types';
import { apertureConfig } from '../../../../aperture.config';

/**
 * Blackout controls on `/admin/settings`, global-admin only: the instance-wide
 * switch on `ap_instance` and the cleared list (`blackout_view` grants on
 * characters and corp titles).
 *
 * Each mutation commits together with a `pg_notify` on the instance channel, so
 * a listener never reads the state from before the change it was told about. No
 * `ap_map_event` row is written: Blackout is instance state, not map state.
 */

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

const FORBIDDEN = { ok: false, error: 'Forbidden.' } as const;

async function adminCharacterId(): Promise<bigint | null> {
  const session = await auth();
  if (!session?.characterId || !(await isAdmin(session))) return null;
  return BigInt(session.characterId);
}

function notifyInstance() {
  return sql`SELECT pg_notify(${apertureConfig.INSTANCE_NOTIFY_CHANNEL}, '')`;
}

/** Turn Blackout on. Already on, the original start time and admin stand. */
export async function adminStartBlackout(): Promise<ActionResult> {
  const actorId = await adminCharacterId();
  if (actorId === null) return FORBIDDEN;

  await db.transaction(async (tx) => {
    await tx
      .insert(apInstance)
      .values({ id: 1, blackoutSince: sql`now()`, blackoutByCharacterId: actorId })
      .onConflictDoUpdate({
        target: apInstance.id,
        set: { blackoutSince: sql`now()`, blackoutByCharacterId: actorId, updatedAt: sql`now()` },
        setWhere: isNull(apInstance.blackoutSince),
      });
    await tx.execute(notifyInstance());
  });

  clearPublicSnapshots();
  revalidatePath('/admin/settings');
  return { ok: true };
}

/** Turn Blackout off. */
export async function adminEndBlackout(): Promise<ActionResult> {
  if ((await adminCharacterId()) === null) return FORBIDDEN;

  await db.transaction(async (tx) => {
    await tx
      .update(apInstance)
      .set({ blackoutSince: null, blackoutByCharacterId: null, updatedAt: sql`now()` })
      .where(eq(apInstance.id, 1));
    await tx.execute(notifyInstance());
  });

  clearPublicSnapshots();
  revalidatePath('/admin/settings');
  return { ok: true };
}

const idSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, 'Invalid id.')
  .transform((s) => BigInt(s));

const clearanceSchema = z.object({
  principalKind: z.enum(['character', 'role'], {
    error: 'The cleared list takes characters and corp titles only.',
  }),
  principalId: idSchema,
  // An ISO instant; empty = permanent.
  expiresAt: z
    .string()
    .trim()
    .transform((s) => (s === '' ? null : new Date(s)))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), 'Invalid expiry date.')
    .refine((d) => d === null || d.getTime() > Date.now(), 'Expiry must be in the future.'),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((s) => (s === '' ? null : s)),
});

/**
 * Add a character or corp title to the cleared list. Re-adding one already on
 * it replaces its expiry and note.
 */
export async function adminAddBlackoutClearance(
  input: z.input<typeof clearanceSchema>,
): Promise<ActionResult> {
  const actorId = await adminCharacterId();
  if (actorId === null) return FORBIDDEN;

  const parsed = clearanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const { principalKind, principalId, expiresAt, note } = parsed.data;

  const [known] =
    principalKind === 'character'
      ? await db.select({ id: apCharacter.id }).from(apCharacter).where(eq(apCharacter.id, principalId))
      : await db
          .select({ id: apRole.id })
          .from(apRole)
          .where(and(eq(apRole.id, principalId), eq(apRole.source, 'corp_title')));
  if (!known) {
    return {
      ok: false,
      error: principalKind === 'character' ? 'Unknown character.' : 'Unknown corp title.',
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(apAccessGrant)
      .values({
        principalKind,
        principalId,
        scope: 'instance',
        mapId: null,
        capability: 'blackout_view',
        expiresAt,
        note,
        grantedByCharacterId: actorId,
      })
      .onConflictDoUpdate({
        target: [
          apAccessGrant.principalKind,
          apAccessGrant.principalId,
          apAccessGrant.scope,
          apAccessGrant.mapId,
          apAccessGrant.capability,
        ],
        set: { expiresAt, note, grantedByCharacterId: actorId, grantedAt: sql`now()` },
      });
    await tx.execute(notifyInstance());
  });

  revalidatePath('/admin/settings');
  return { ok: true };
}

/** Remove a cleared-list entry. Refuses any grant that is not `blackout_view`. */
export async function adminRemoveBlackoutClearance(grantId: string): Promise<ActionResult> {
  if ((await adminCharacterId()) === null) return FORBIDDEN;

  const parsed = idSchema.safeParse(grantId);
  if (!parsed.success) return { ok: false, error: 'Invalid grant id.' };

  const removed = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(apAccessGrant)
      .where(
        and(
          eq(apAccessGrant.id, parsed.data),
          eq(apAccessGrant.scope, 'instance'),
          eq(apAccessGrant.capability, 'blackout_view'),
        ),
      )
      .returning({ id: apAccessGrant.id });
    if (rows.length === 0) return false;
    await tx.execute(notifyInstance());
    return true;
  });
  if (!removed) return { ok: false, error: 'Not a cleared-list entry.' };

  revalidatePath('/admin/settings');
  return { ok: true };
}

/** Load the switch, the cleared list and the picker options for the panel. */
export async function adminLoadBlackoutPanel(): Promise<ActionResult<BlackoutPanelData>> {
  if ((await adminCharacterId()) === null) return FORBIDDEN;

  const [state] = await db
    .select({ since: apInstance.blackoutSince, byName: apCharacter.name })
    .from(apInstance)
    .leftJoin(apCharacter, eq(apCharacter.id, apInstance.blackoutByCharacterId))
    .where(eq(apInstance.id, 1));

  const clearances = await db
    .select({
      grantId: apAccessGrant.id,
      principalKind: apAccessGrant.principalKind,
      principalId: apAccessGrant.principalId,
      characterName: apCharacter.name,
      roleName: apRole.name,
      roleLabel: apRole.displayLabel,
      corporationName: apCorporation.name,
      expiresAt: apAccessGrant.expiresAt,
      expired: sql<boolean>`coalesce(${apAccessGrant.expiresAt} <= now(), false)`,
      note: apAccessGrant.note,
    })
    .from(apAccessGrant)
    .leftJoin(
      apCharacter,
      and(eq(apAccessGrant.principalKind, 'character'), eq(apCharacter.id, apAccessGrant.principalId)),
    )
    .leftJoin(
      apRole,
      and(eq(apAccessGrant.principalKind, 'role'), eq(apRole.id, apAccessGrant.principalId)),
    )
    .leftJoin(apCorporation, eq(apCorporation.id, apRole.corporationId))
    .where(and(eq(apAccessGrant.scope, 'instance'), eq(apAccessGrant.capability, 'blackout_view')))
    .orderBy(
      asc(apAccessGrant.principalKind),
      asc(sql`coalesce(${apCharacter.name}, ${apRole.displayLabel}, ${apRole.name})`),
    );

  const characters = await db
    .select({ id: apCharacter.id, name: apCharacter.name })
    .from(apCharacter)
    .where(eq(apCharacter.status, 'active'))
    .orderBy(asc(apCharacter.name));

  const titles = await db
    .select({
      roleId: apRole.id,
      name: apRole.name,
      displayLabel: apRole.displayLabel,
      corporationId: apCorporation.id,
      corporationName: apCorporation.name,
    })
    .from(apRole)
    .innerJoin(apCorporation, eq(apCorporation.id, apRole.corporationId))
    .where(eq(apRole.source, 'corp_title'))
    .orderBy(asc(apCorporation.name), asc(apRole.name));

  const since = state?.since ?? null;
  return {
    ok: true,
    data: {
      active: since !== null,
      since: since?.toISOString() ?? null,
      byCharacterName: since === null ? null : (state?.byName ?? null),
      clearances: clearances.map((c) => ({
        grantId: c.grantId.toString(),
        // The principal CHECK holds blackout_view grants to characters and titles.
        principalKind: c.principalKind as 'character' | 'role',
        principalId: c.principalId.toString(),
        name: c.characterName ?? c.roleLabel ?? c.roleName,
        corporationName: c.principalKind === 'role' ? c.corporationName : null,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        expired: c.expired,
        note: c.note,
      })),
      characters: characters.map((c) => ({ id: c.id.toString(), name: c.name })),
      titles: titles.map((t) => ({
        roleId: t.roleId.toString(),
        label: t.displayLabel ?? t.name,
        corporationId: t.corporationId.toString(),
        corporationName: t.corporationName,
      })),
    },
  };
}
