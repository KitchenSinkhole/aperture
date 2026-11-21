// No `import 'server-only'`: it reaches `commitMapEvent` and `authorize.ts`,
// both of which load under plain Node.
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMap, apMapApiToken, apUser } from '@/db/schema';
import { getLogger } from '@/lib/log/logger';
import { commitMapEvent } from '@/lib/map/mutations/core';
import { recordUserApiStrike } from '@/lib/metrics/registry';
import type { UserApiStrikeOutcome } from '@/types';
import { apertureConfig } from '../../../aperture.config';
import {
  invalidateUserApiAccount,
  invalidateUserApiToken,
  isUserApiAccountBlocked,
} from './authorize';

/**
 * The user API abuse ladder: a strike on a token suspends it (strikes 1 and 2)
 * or revokes it and blocks its owning account (strike 3). Strikes are detected
 * in-process by `rateLimit.ts`; this module persists them. Each transition is
 * exactly one audit-only `ap_map_event` (`api.token_suspended` /
 * `api.token_revoked`, actorless), and the auth cache is invalidated after it commits so the very
 * next request sees it.
 */

const log = getLogger('server');
const DAY_MS = 86_400_000;

/**
 * The number the next strike on a token carries: one more than its current
 * count, or 1 when its previous strike is older than
 * `USER_API_STRIKE_DECAY_DAYS` (or there was none).
 */
export function nextUserApiStrike(
  token: { strikeCount: number; lastStrikeAt: Date | null },
  now: Date,
): number {
  const decayed =
    token.lastStrikeAt === null ||
    now.getTime() - token.lastStrikeAt.getTime() > apertureConfig.USER_API_STRIKE_DECAY_DAYS * DAY_MS;
  return (decayed ? 0 : token.strikeCount) + 1;
}

/** Suspension length for a strike, or null when the strike revokes the token. */
export function userApiSuspensionMs(strike: number): number | null {
  return apertureConfig.USER_API_STRIKE_SUSPENSIONS_MS[strike - 1] ?? null;
}

/**
 * End of an automatic account block starting at `now`: `USER_API_FIRST_BLOCK_DAYS`
 * ahead, or null (indefinite) when the account's previous block began within
 * `USER_API_REPEAT_OFFENCE_WINDOW_DAYS`.
 */
export function userApiAccountBlockUntil(previousBlockedAt: Date | null, now: Date): Date | null {
  if (
    previousBlockedAt !== null &&
    now.getTime() - previousBlockedAt.getTime() <=
      apertureConfig.USER_API_REPEAT_OFFENCE_WINDOW_DAYS * DAY_MS
  ) {
    return null;
  }
  return new Date(now.getTime() + apertureConfig.USER_API_FIRST_BLOCK_DAYS * DAY_MS);
}

/**
 * Persists one strike on `tokenId` and applies its consequence, as one
 * transaction holding the token and account rows. Strikes 1 and 2 suspend the
 * token; strike 3 revokes it (`revoked_reason='abuse'`) and blocks the account,
 * unless the account is already blocked, in which case that block stands.
 * Returns null, writing nothing, for a token that is missing or already
 * revoked. Never throws: a failure is logged and returns null, so the request
 * path can fire it and move on.
 */
export async function applyUserApiStrike(
  tokenId: bigint,
  now: Date = new Date(),
): Promise<UserApiStrikeOutcome | null> {
  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          mapId: apMapApiToken.mapId,
          userId: apMapApiToken.userId,
          label: apMapApiToken.label,
          strikeCount: apMapApiToken.strikeCount,
          lastStrikeAt: apMapApiToken.lastStrikeAt,
          revokedAt: apMapApiToken.revokedAt,
          apiBlockedAt: apUser.apiBlockedAt,
          apiBlockedUntil: apUser.apiBlockedUntil,
        })
        .from(apMapApiToken)
        .innerJoin(apMap, eq(apMap.id, apMapApiToken.mapId))
        .innerJoin(apUser, eq(apUser.id, apMapApiToken.userId))
        .where(eq(apMapApiToken.id, tokenId))
        .for('update', { of: [apMapApiToken, apUser] })
        .limit(1);
      if (!row || row.revokedAt !== null) return null;

      const strike = nextUserApiStrike(row, now);
      const named = { tokenId: tokenId.toString(), label: row.label };
      const suspensionMs = userApiSuspensionMs(strike);

      if (suspensionMs !== null) {
        const until = new Date(now.getTime() + suspensionMs);
        const committed = await commitMapEvent({
          tx,
          mapId: row.mapId,
          characterId: null,
          kind: 'api.token_suspended',
          mutate: async (tx) => {
            await tx
              .update(apMapApiToken)
              .set({ strikeCount: strike, lastStrikeAt: now, suspendedUntil: until })
              .where(eq(apMapApiToken.id, tokenId));
            return { ...named, until: until.toISOString(), strike };
          },
        });
        if (!committed.ok) throw new Error(committed.error);
        const outcome: UserApiStrikeOutcome = {
          action: 'suspended',
          strike,
          until,
          eventId: committed.eventId,
        };
        return { outcome, mapId: row.mapId, userId: row.userId };
      }

      const accountBlocked = !isUserApiAccountBlocked(row, now);
      const accountBlockedUntil = accountBlocked
        ? userApiAccountBlockUntil(row.apiBlockedAt, now)
        : null;
      const committed = await commitMapEvent({
        tx,
        mapId: row.mapId,
        characterId: null,
        kind: 'api.token_revoked',
        mutate: async (tx) => {
          await tx
            .update(apMapApiToken)
            .set({
              strikeCount: strike,
              lastStrikeAt: now,
              revokedAt: now,
              revokedReason: 'abuse',
              revokedByCharacterId: null,
            })
            .where(eq(apMapApiToken.id, tokenId));
          if (accountBlocked) {
            await tx
              .update(apUser)
              .set({
                apiBlockedAt: now,
                apiBlockedUntil: accountBlockedUntil,
                apiBlockReason: `Automatic block: the API token "${row.label}" kept sending requests after being rate limited and suspended.`,
              })
              .where(eq(apUser.id, row.userId));
          }
          return { ...named, reason: 'abuse' as const };
        },
      });
      if (!committed.ok) throw new Error(committed.error);
      const outcome: UserApiStrikeOutcome = {
        action: 'revoked',
        strike,
        accountBlocked,
        accountBlockedUntil,
        eventId: committed.eventId,
      };
      return { outcome, mapId: row.mapId, userId: row.userId };
    });
    if (result === null) return null;

    const { outcome, mapId, userId } = result;
    invalidateUserApiToken(tokenId);
    recordUserApiStrike(outcome.strike);
    if (outcome.action === 'revoked' && outcome.accountBlocked) {
      invalidateUserApiAccount(userId);
      log.warn('user API account blocked', {
        userId,
        tokenId: tokenId.toString(),
        mapId: mapId.toString(),
        until: outcome.accountBlockedUntil?.toISOString() ?? null,
      });
    }
    return outcome;
  } catch (err) {
    log.error('user API strike failed', { tokenId: tokenId.toString(), err });
    return null;
  }
}
