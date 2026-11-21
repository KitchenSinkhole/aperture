'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apCharacter, apUser } from '@/db/schema';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/auth/rights';
import { getLogger } from '@/lib/log/logger';
import { invalidateUserApiAccount } from '@/lib/userApi/authorize';

/**
 * Admin moderation actions on `ap_character` rows: `kick` / `ban` / `activate`.
 * All gated by `isAdmin` — moderation is a global-operator concern only. Corp
 * Directors carry map-management authority (`canManageMap`) but not the power to
 * kick or ban; that eliminates the old privilege-inversion where a corp-scoped
 * manager could moderate.
 *
 * Actions write directly to `ap_character.status`. No `ap_map_event` audit row
 * is written (`ap_map_event` is map-scoped, so character-moderation changes are
 * intentionally out of its scope). The dashboard counts in `/admin` reflect the
 * new state on next load via `revalidatePath`.
 */

const characterIdSchema = z.string().regex(/^\d+$/, 'Invalid character id.');
const kickMinutesSchema = z.union([
  z.literal(5),
  z.literal(60),
  z.literal(1440),
]);
const reasonSchema = z.string().trim().min(1).max(500);
const optionalReasonSchema = z
  .string()
  .trim()
  .max(500)
  .transform((s) => (s.length === 0 ? null : s))
  .nullable()
  .optional();

type ActionResult = { ok: true } | { ok: false; error: string };

const log = getLogger('server');

async function gateAdmin(): Promise<ActionResult> {
  const session = await auth();
  if (!(await isAdmin(session))) return { ok: false, error: 'Admin required.' };
  return { ok: true };
}

async function characterExists(id: bigint): Promise<boolean> {
  const [row] = await db
    .select({ id: apCharacter.id })
    .from(apCharacter)
    .where(eq(apCharacter.id, id));
  return row !== undefined;
}

/**
 * Set `status='kicked'` with a fixed-minutes timeout. The `character-cleanup`
 * cron flips the row back to `'active'` on expiry (`src/lib/jobs/tasks/characterCleanup.ts`).
 * Three durations only — 5, 60, 1440 minutes.
 */
export async function adminKickCharacter(
  characterId: string,
  minutes: 5 | 60 | 1440,
  reason?: string,
): Promise<ActionResult> {
  const parsedId = characterIdSchema.safeParse(characterId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]!.message };
  const parsedMinutes = kickMinutesSchema.safeParse(minutes);
  if (!parsedMinutes.success) return { ok: false, error: 'Invalid kick duration.' };
  const parsedReason = optionalReasonSchema.safeParse(reason);
  if (!parsedReason.success) return { ok: false, error: 'Invalid reason.' };

  const gate = await gateAdmin();
  if (!gate.ok) return gate;
  const id = BigInt(parsedId.data);
  if (!(await characterExists(id))) return { ok: false, error: 'Character not found.' };

  await db
    .update(apCharacter)
    .set({
      status: 'kicked',
      statusExpiresAt: sql`now() + (${parsedMinutes.data} * interval '1 minute')`,
      statusReason: parsedReason.data ?? null,
      statusChangedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(apCharacter.id, id));

  revalidatePath('/admin/members');
  revalidatePath('/admin');
  return { ok: true };
}

/**
 * Set `status='banned'` permanently — `status_expires_at` stays NULL so the
 * `character-cleanup` cron never lifts it. A free-text `reason` is required.
 */
export async function adminBanCharacter(
  characterId: string,
  reason: string,
): Promise<ActionResult> {
  const parsedId = characterIdSchema.safeParse(characterId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]!.message };
  const parsedReason = reasonSchema.safeParse(reason);
  if (!parsedReason.success) return { ok: false, error: 'Reason is required.' };

  const gate = await gateAdmin();
  if (!gate.ok) return gate;
  const id = BigInt(parsedId.data);
  if (!(await characterExists(id))) return { ok: false, error: 'Character not found.' };

  await db
    .update(apCharacter)
    .set({
      status: 'banned',
      statusExpiresAt: null,
      statusReason: parsedReason.data,
      statusChangedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(apCharacter.id, id));

  revalidatePath('/admin/members');
  revalidatePath('/admin');
  return { ok: true };
}

/**
 * Clear any moderation state — works on both `'kicked'` and `'banned'` rows.
 * Sets `status='active'` and nulls `status_expires_at` / `status_reason`.
 */
export async function adminActivateCharacter(
  characterId: string,
): Promise<ActionResult> {
  const parsedId = characterIdSchema.safeParse(characterId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]!.message };

  const gate = await gateAdmin();
  if (!gate.ok) return gate;
  const id = BigInt(parsedId.data);
  if (!(await characterExists(id))) return { ok: false, error: 'Character not found.' };

  await db
    .update(apCharacter)
    .set({
      status: 'active',
      statusExpiresAt: null,
      statusReason: null,
      statusChangedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(apCharacter.id, id));

  revalidatePath('/admin/members');
  revalidatePath('/admin');
  return { ok: true };
}

async function accountOfCharacter(id: bigint): Promise<number | null> {
  const [row] = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(eq(apCharacter.id, id));
  return row?.userId ?? null;
}

/**
 * Block the user API for the whole account `characterId` belongs to, until an
 * admin lifts it (`api_blocked_until` NULL). A free-text `reason` is required
 * and is shown to the account. While blocked the account cannot mint and every
 * token it owns answers `account_blocked`. Writes no `ap_map_event` (the block
 * is not map-scoped); logged at `warn`.
 */
export async function adminBlockUserApi(
  characterId: string,
  reason: string,
): Promise<ActionResult> {
  const parsedId = characterIdSchema.safeParse(characterId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]!.message };
  const parsedReason = reasonSchema.safeParse(reason);
  if (!parsedReason.success) return { ok: false, error: 'Reason is required.' };

  const gate = await gateAdmin();
  if (!gate.ok) return gate;
  const userId = await accountOfCharacter(BigInt(parsedId.data));
  if (userId === null) return { ok: false, error: 'Character not found.' };

  // The app clock, not the database's: the block is evaluated against it.
  const now = new Date();
  await db
    .update(apUser)
    .set({
      apiBlockedAt: now,
      apiBlockedUntil: null,
      apiBlockReason: parsedReason.data,
      updatedAt: now,
    })
    .where(eq(apUser.id, userId));
  // After the write commits, so the very next request reads the block.
  invalidateUserApiAccount(userId);
  log.warn('user API account blocked by an admin', { userId, characterId: parsedId.data });

  revalidatePath('/admin/members');
  return { ok: true };
}

/**
 * Lift the account's standing user API block, timed or indefinite, by ending
 * it now (`api_blocked_until = now()`). `api_blocked_at` is kept, since the
 * repeat-offence window reads it. Refused when the account is not blocked.
 */
export async function adminLiftUserApiBlock(characterId: string): Promise<ActionResult> {
  const parsedId = characterIdSchema.safeParse(characterId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]!.message };

  const gate = await gateAdmin();
  if (!gate.ok) return gate;
  const userId = await accountOfCharacter(BigInt(parsedId.data));
  if (userId === null) return { ok: false, error: 'Character not found.' };

  const now = new Date();
  const lifted = await db
    .update(apUser)
    .set({ apiBlockedUntil: now, updatedAt: now })
    .where(
      and(
        eq(apUser.id, userId),
        isNotNull(apUser.apiBlockedAt),
        or(isNull(apUser.apiBlockedUntil), gt(apUser.apiBlockedUntil, now)),
      ),
    )
    .returning({ id: apUser.id });
  if (lifted.length === 0) return { ok: false, error: 'This account has no API block.' };
  invalidateUserApiAccount(userId);
  log.warn('user API account block lifted by an admin', { userId, characterId: parsedId.data });

  revalidatePath('/admin/members');
  return { ok: true };
}
