'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apUser } from '@/db/schema';
import { signOut } from '@/lib/auth';
import {
  assertCharacterOwnership,
  getGlobalStaleThresholdMinutes,
  requireSession,
} from '@/lib/session';
import { mapLayoutConfigSchema } from '@/lib/map/layout/schema';
import { migrateLayout } from '@/lib/map/layout/panels';

// Account self-service. Low-frequency, user-initiated state changes
// over ap_user — Server Actions per the CLAUDE.md mutation pathways.

export type AccountActionResult = { ok: true } | { ok: false; error: string };

/**
 * Set the account's main character — the identity login lands on and that
 * statistics / activity roll up to. The target must be an active character on
 * the current account.
 */
export async function setMainCharacterAction(
  targetCharacterId: string,
): Promise<AccountActionResult> {
  const session = await requireSession();
  let target: bigint;
  try {
    target = BigInt(targetCharacterId);
  } catch {
    return { ok: false, error: 'Invalid character.' };
  }
  if (!(await assertCharacterOwnership(target, session.userId))) {
    return { ok: false, error: 'That character is not available on this account.' };
  }
  await db
    .update(apUser)
    .set({ mainCharacterId: target, updatedAt: new Date() })
    .where(eq(apUser.id, session.userId));
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Toggle the per-account connection travel animation (the subtle moving dot
 * played on a connection when a tracked pilot jumps across it). Persisted on
 * `ap_user`; the per-map row stays untouched because the preference is personal,
 * not shared with other viewers of the map.
 */
export async function setConnectionTravelAnimationAction(
  enabled: boolean,
): Promise<AccountActionResult> {
  const session = await requireSession();
  await db
    .update(apUser)
    .set({ connectionTravelAnimation: enabled, updatedAt: new Date() })
    .where(eq(apUser.id, session.userId));
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Persist the account's stale/unscanned signature-indicator preferences: the two
 * on/off toggles and an optional stale-threshold override. The override is capped
 * at the global default (`ap_instance`) — a user may make the indicator *more*
 * eager (a smaller value) but never larger, so they can't quietly ignore the corp
 * default. `null` clears the override (use the global). Personal, so no per-map row.
 */
export async function setSignatureIndicatorPrefsAction(input: {
  thresholdMinutes: number | null;
  showStale: boolean;
  showUnscanned: boolean;
}): Promise<AccountActionResult> {
  const session = await requireSession();

  let override: number | null = null;
  if (input.thresholdMinutes != null) {
    const n = input.thresholdMinutes;
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, error: 'Threshold must be a positive whole number of minutes.' };
    }
    const global = await getGlobalStaleThresholdMinutes();
    if (n > global) {
      return { ok: false, error: `Threshold can be at most the corp default (${global} min).` };
    }
    override = n;
  }

  await db
    .update(apUser)
    .set({
      staleSignatureThresholdMinutes: override,
      showStaleSignatureIndicator: input.showStale,
      showUnscannedSignatureIndicator: input.showUnscanned,
      updatedAt: new Date(),
    })
    .where(eq(apUser.id, session.userId));
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Persist the account's free-form map dashboard layout (map-layout-builder). One
 * global arrangement per account, applied to every map. The payload is unknown
 * user JSON — validated at this boundary before it reaches the column. Revalidates
 * the `/` layout so a freshly-rendered map picks up the saved arrangement.
 */
export async function setMapLayoutAction(config: unknown): Promise<AccountActionResult> {
  const session = await requireSession();
  const parsed = mapLayoutConfigSchema.safeParse(config);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid layout.' };
  }
  // Normalise to the current version (fill singleton groups) so a legacy or
  // client-sent pre-v2 blob never reaches the column ungrouped.
  const layout = migrateLayout(parsed.data);
  await db
    .update(apUser)
    .set({ mapLayout: layout, updatedAt: new Date() })
    .where(eq(apUser.id, session.userId));
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Delete the account and every character on it. The FK rules do the rest:
 * characters / roles / tracking cascade away, audit rows (`ap_map_event`,
 * `ap_structure_event`) keep their history with `character_id` set null, and
 * owned maps are orphaned (`owner_character_id` set null). Irreversible — there
 * is no soft-delete grace for accounts. On success the user is signed out and
 * returned to the public splash (`signOut` throws a redirect and never returns).
 */
export async function deleteAccountAction(): Promise<AccountActionResult> {
  const session = await requireSession();
  try {
    await db.delete(apUser).where(eq(apUser.id, session.userId));
  } catch {
    return { ok: false, error: 'Could not delete account.' };
  }
  await signOut({ redirectTo: '/' });
  return { ok: true };
}
