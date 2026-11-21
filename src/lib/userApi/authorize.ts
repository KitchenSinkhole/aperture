// No `import 'server-only'`: the abuse ladder and the admin block actions call
// the invalidation exports, and `rights.ts` / `loginGate.ts` / `blackout.ts`,
// which this module calls, all load under plain Node for the same reason.
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apCharacter, apiScope, apMap, apMapApiToken, apUser } from '@/db/schema';
import { getBlackoutStatus } from '@/lib/auth/blackout';
import { isLoginAllowed } from '@/lib/auth/loginGate';
import { canViewMap } from '@/lib/auth/rights';
import type {
  ApiScope,
  UserApiDecision,
  UserApiErrorCode,
  UserApiTokenRecord,
} from '@/types';
import { apertureConfig } from '../../../aperture.config';
import { hashUserApiToken, parseUserApiBearer } from './token';

/**
 * Token resolution and the access decision for the `/api/v1/*` user API:
 * parse, resolve and decide (pipeline steps 3 to 5) plus the scope check
 * (step 7). Rate limiting sits between decide and scope and is not here.
 *
 * Resolved records are cached in-process by token hash for
 * `USER_API_AUTH_CACHE_TTL_MS`, misses included. Time-dependent conditions
 * (expiry, suspension, account block) are evaluated against the clock at
 * decide time, so they never wait on the TTL. Explicit changes call the
 * invalidation exports; changes the server only observes apply within the TTL.
 *
 * State is a `globalThis` singleton so it survives HMR.
 */

type CacheEntry = { record: UserApiTokenRecord | null; expiresAt: number };

interface AuthCacheState {
  cache: Map<string, CacheEntry>;
  inflight: Map<string, Promise<UserApiTokenRecord | null>>;
  /** Bumped by every invalidation; a load begun under an older value is not cached. */
  generation: number;
}

declare global {
  var __apertureUserApiAuth: AuthCacheState | undefined;
}

const state: AuthCacheState = globalThis.__apertureUserApiAuth ?? {
  cache: new Map(),
  inflight: new Map(),
  generation: 0,
};
globalThis.__apertureUserApiAuth = state;

export type UserApiTokenLoader = (hash: string, now: Date) => Promise<UserApiTokenRecord | null>;

/** True while the account's API block stands at `now`. */
export function isUserApiAccountBlocked(
  account: Pick<UserApiTokenRecord['account'], 'apiBlockedAt' | 'apiBlockedUntil'>,
  now: Date,
): boolean {
  if (account.apiBlockedAt === null) return false;
  return account.apiBlockedUntil === null || account.apiBlockedUntil > now;
}

function isDead(record: UserApiTokenRecord, now: Date): boolean {
  const { token, map } = record;
  return (
    token.revokedAt !== null ||
    (token.expiresAt !== null && token.expiresAt <= now) ||
    map.deletedAt !== null
  );
}

/**
 * Reads a token by hash with its map, owning account and that account's main
 * in one query, then evaluates the main's standing. A main that is no longer
 * on the account reads as no main. The standing is skipped (`access: null`)
 * for a token already dead at `now`.
 */
export async function loadUserApiTokenRecord(
  hash: string,
  now: Date,
): Promise<UserApiTokenRecord | null> {
  const [row] = await db
    .select({
      tokenId: apMapApiToken.id,
      mapId: apMapApiToken.mapId,
      userId: apMapApiToken.userId,
      label: apMapApiToken.label,
      prefix: apMapApiToken.tokenPrefix,
      scopes: apMapApiToken.scopes,
      expiresAt: apMapApiToken.expiresAt,
      revokedAt: apMapApiToken.revokedAt,
      suspendedUntil: apMapApiToken.suspendedUntil,
      mapName: apMap.name,
      mapDeletedAt: apMap.deletedAt,
      apiEnabled: apMap.apiEnabled,
      apiScopes: apMap.apiScopes,
      apiBlockedAt: apUser.apiBlockedAt,
      apiBlockedUntil: apUser.apiBlockedUntil,
      apiBlockReason: apUser.apiBlockReason,
      mainId: apCharacter.id,
      mainName: apCharacter.name,
      mainStatus: apCharacter.status,
      mainCorporationId: apCharacter.corporationId,
      mainAllianceId: apCharacter.allianceId,
    })
    .from(apMapApiToken)
    .innerJoin(apMap, eq(apMap.id, apMapApiToken.mapId))
    .innerJoin(apUser, eq(apUser.id, apMapApiToken.userId))
    .leftJoin(
      apCharacter,
      and(eq(apCharacter.id, apUser.mainCharacterId), eq(apCharacter.userId, apUser.id)),
    )
    .where(eq(apMapApiToken.tokenHash, hash))
    .limit(1);
  if (!row) return null;

  const record: UserApiTokenRecord = {
    token: {
      id: row.tokenId,
      mapId: row.mapId,
      userId: row.userId,
      label: row.label,
      prefix: row.prefix,
      scopes: row.scopes,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      suspendedUntil: row.suspendedUntil,
    },
    map: {
      id: row.mapId,
      name: row.mapName,
      deletedAt: row.mapDeletedAt,
      apiEnabled: row.apiEnabled,
      apiScopes: row.apiScopes,
    },
    account: {
      userId: row.userId,
      mainCharacterId: row.mainId,
      mainCharacterName: row.mainName,
      apiBlockedAt: row.apiBlockedAt,
      apiBlockedUntil: row.apiBlockedUntil,
      apiBlockReason: row.apiBlockReason,
    },
    access: null,
  };
  if (isDead(record, now)) return record;

  const mainId = row.mainId;
  const [mainCanView, mainLoginAllowed, blackout] = await Promise.all([
    mainId === null ? false : canViewMap(mainId, row.mapId),
    mainId === null || row.mainStatus !== 'active'
      ? false
      : isLoginAllowed({
          characterId: mainId,
          corporationId: row.mainCorporationId,
          allianceId: row.mainAllianceId,
        }),
    getBlackoutStatus(row.userId),
  ]);
  record.access = {
    mainCanView,
    mainLoginAllowed,
    blackout: { active: blackout.active, cleared: blackout.cleared, userId: row.userId },
  };
  return record;
}

/**
 * The resolved record for a token hash, from cache while a live entry exists.
 * Concurrent misses for one hash share one load. A rejected load caches nothing
 * and propagates.
 */
export async function resolveUserApiToken(
  hash: string,
  now: number = Date.now(),
  load: UserApiTokenLoader = loadUserApiTokenRecord,
): Promise<UserApiTokenRecord | null> {
  const hit = state.cache.get(hash);
  if (hit && hit.expiresAt > now) {
    state.cache.delete(hash);
    state.cache.set(hash, hit);
    return hit.record;
  }

  const inflight = state.inflight.get(hash);
  if (inflight) return inflight;

  const generation = state.generation;
  const pending = load(hash, new Date(now))
    .then((record) => {
      if (generation !== state.generation) return record;
      state.cache.delete(hash);
      state.cache.set(hash, {
        record,
        expiresAt: now + apertureConfig.USER_API_AUTH_CACHE_TTL_MS,
      });
      while (state.cache.size > apertureConfig.USER_API_AUTH_CACHE_MAX_ENTRIES) {
        const oldest = state.cache.keys().next();
        if (oldest.done) break;
        state.cache.delete(oldest.value);
      }
      return record;
    })
    .finally(() => {
      if (state.inflight.get(hash) === pending) state.inflight.delete(hash);
    });

  state.inflight.set(hash, pending);
  return pending;
}

function refuse(
  status: 401 | 403,
  code: UserApiErrorCode,
  record: UserApiTokenRecord | null,
  retryAfterSec?: number,
): UserApiDecision {
  return retryAfterSec === undefined
    ? { ok: false, status, code, record }
    : { ok: false, status, code, record, retryAfterSec };
}

/**
 * The access decision over a resolved record (pipeline step 5), pure. The
 * first matching row wins:
 * unknown / revoked / expired / deleted map → 401 `invalid_token`;
 * account blocked → 403 `account_blocked`;
 * token suspended → 403 `token_suspended` with `retryAfterSec`;
 * map API off → 403 `api_disabled`;
 * no main, or the main fails `canViewMap` or the login gate → 403 `access_lost`.
 */
export function decideUserApiAccess(
  record: UserApiTokenRecord | null,
  now: Date,
): UserApiDecision {
  if (!record || isDead(record, now)) return refuse(401, 'invalid_token', null);
  if (isUserApiAccountBlocked(record.account, now)) {
    return refuse(403, 'account_blocked', record);
  }
  const { suspendedUntil } = record.token;
  if (suspendedUntil !== null && suspendedUntil > now) {
    const retryAfterSec = Math.max(1, Math.ceil((suspendedUntil.getTime() - now.getTime()) / 1000));
    return refuse(403, 'token_suspended', record, retryAfterSec);
  }
  if (!record.map.apiEnabled) return refuse(403, 'api_disabled', record);
  if (
    record.account.mainCharacterId === null ||
    record.access === null ||
    !record.access.mainCanView ||
    !record.access.mainLoginAllowed
  ) {
    return refuse(403, 'access_lost', record);
  }
  return { ok: true, record };
}

/** The scopes a token can use right now: its own scopes that the map still exposes, in enum order. */
export function effectiveUserApiScopes(record: UserApiTokenRecord): ApiScope[] {
  return apiScope.enumValues.filter(
    (s) => record.token.scopes.includes(s) && record.map.apiScopes.includes(s),
  );
}

/** Pipeline step 7: an allowed record may read `scope` only if it is effective. */
export function checkUserApiScope(record: UserApiTokenRecord, scope: ApiScope): UserApiDecision {
  return effectiveUserApiScopes(record).includes(scope)
    ? { ok: true, record }
    : refuse(403, 'scope_not_granted', record);
}

/**
 * Pipeline steps 3 to 5 for an `Authorization` header value. A malformed
 * header is refused without a database read. Every 401 is a failed auth.
 */
export async function authorizeUserApiBearer(
  header: string | null | undefined,
  now: number = Date.now(),
): Promise<UserApiDecision> {
  const raw = parseUserApiBearer(header);
  if (raw === null) return refuse(401, 'invalid_token', null);
  const record = await resolveUserApiToken(hashUserApiToken(raw), now);
  return decideUserApiAccess(record, new Date(now));
}

function invalidateWhere(match: (record: UserApiTokenRecord) => boolean): void {
  state.generation += 1;
  state.inflight.clear();
  for (const [hash, entry] of state.cache) {
    if (entry.record !== null && match(entry.record)) state.cache.delete(hash);
  }
}

/** Drops the cached record of one token (revoke, suspend). */
export function invalidateUserApiToken(tokenId: bigint): void {
  invalidateWhere((r) => r.token.id === tokenId);
}

/** Drops every cached token record on one map (API switch, scope change). */
export function invalidateUserApiMap(mapId: bigint): void {
  invalidateWhere((r) => r.map.id === mapId);
}

/** Drops every cached token record owned by one account (block, lift, main change). */
export function invalidateUserApiAccount(userId: number): void {
  invalidateWhere((r) => r.account.userId === userId);
}

/** Drops every cached record, misses included (the Blackout switch). */
export function clearUserApiAuthCache(): void {
  state.generation += 1;
  state.inflight.clear();
  state.cache.clear();
}
