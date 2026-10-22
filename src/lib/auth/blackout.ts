// NOTE: deliberately no `import 'server-only'` — reached from `wsServer.ts`
// (custom Node entry) and the location-poll job runner, both of which load
// under plain Node without the `react-server` resolver condition.
import { and, eq, exists, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apAccessGrant, apCharacter, apCharacterRole, apInstance } from '@/db/schema';
import type { BlackoutState, BlackoutStatus, BlackoutViewer } from '@/types';

/**
 * Blackout: an instance-wide switch that hides every tracked pilot's presence
 * from everyone except the pilot's own account and the cleared list.
 *
 * Every presence egress asks the same question, "is this pilot hidden from this
 * viewer?", through `isPilotHidden`; surfaces hidden wholesale (the mass log,
 * audit actors) ask `isBlackedOut`. A narrower Blackout would change these
 * answers, not their call sites.
 */

/** Read the Blackout switch. A missing singleton row reads as off. */
export async function getBlackoutState(): Promise<BlackoutState> {
  const [row] = await db
    .select({
      since: apInstance.blackoutSince,
      byCharacterId: apInstance.blackoutByCharacterId,
    })
    .from(apInstance)
    .where(eq(apInstance.id, 1));
  const since = row?.since ?? null;
  return { active: since !== null, since, byCharacterId: row?.byCharacterId ?? null };
}

/**
 * Whether an account sees pilots during a Blackout. It does when any of its
 * `active` characters is a global admin, holds an unexpired `blackout_view`
 * grant by name, or holds a title carrying one. Kicked and banned characters
 * never count, so neither their grants nor their titles clear the account.
 */
export async function isBlackoutCleared(userId: number): Promise<boolean> {
  const heldGrant = exists(
    db
      .select({ one: sql<number>`1` })
      .from(apAccessGrant)
      .where(
        and(
          eq(apAccessGrant.scope, 'instance'),
          eq(apAccessGrant.capability, 'blackout_view'),
          or(isNull(apAccessGrant.expiresAt), gt(apAccessGrant.expiresAt, sql`now()`)),
          or(
            and(
              eq(apAccessGrant.principalKind, 'character'),
              eq(apAccessGrant.principalId, apCharacter.id),
            ),
            and(
              eq(apAccessGrant.principalKind, 'role'),
              inArray(
                apAccessGrant.principalId,
                db
                  .select({ roleId: apCharacterRole.roleId })
                  .from(apCharacterRole)
                  .where(eq(apCharacterRole.characterId, apCharacter.id)),
              ),
            ),
          ),
        ),
      ),
  );

  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(apCharacter)
    .where(
      and(
        eq(apCharacter.userId, userId),
        eq(apCharacter.status, 'active'),
        or(eq(apCharacter.authzLevel, 'admin'), heldGrant),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * One account's standing under Blackout, in the shape `healthCheck.blackout`
 * carries. `cleared` is resolved whether or not Blackout is on.
 */
export async function getBlackoutStatus(userId: number): Promise<BlackoutStatus> {
  const [state, cleared] = await Promise.all([getBlackoutState(), isBlackoutCleared(userId)]);
  return { active: state.active, since: state.since?.toISOString() ?? null, cleared };
}

/** Whether Blackout currently restricts what this viewer sees. */
export function isBlackedOut(viewer: Pick<BlackoutViewer, 'active' | 'cleared'>): boolean {
  return viewer.active && !viewer.cleared;
}

/**
 * The presence rule: a pilot on account `pilotUserId` is hidden from `viewer`
 * while Blackout restricts the viewer, unless the pilot is on the viewer's own
 * account.
 */
export function isPilotHidden(viewer: BlackoutViewer, pilotUserId: number): boolean {
  return isBlackedOut(viewer) && pilotUserId !== viewer.userId;
}
