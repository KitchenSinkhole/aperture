'use server';

import { and, count, desc, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apCharacter, apiScope, apMap, apMapApiToken, apUser } from '@/db/schema';
import { isLoginAllowed } from '@/lib/auth/loginGate';
import {
  canUseMapFeature,
  canViewMap,
  requireMapCapability,
  requireMapView,
} from '@/lib/auth/rights';
import { commitMapEvent, enqueueWebhookDispatch } from '@/lib/map/mutations/core';
import { requireSession } from '@/lib/session';
import {
  invalidateUserApiMap,
  invalidateUserApiToken,
  isUserApiAccountBlocked,
} from '@/lib/userApi/authorize';
import { isUserApiInstanceEnabled } from '@/lib/userApi/instance';
import { generateUserApiToken } from '@/lib/userApi/token';
import type {
  AccountApiState,
  ApiScope,
  MapApiState,
  UserApiAccountBlock,
  UserApiTokenListItem,
  UserApiTokenStatus,
} from '@/types';
import { apertureConfig } from '../../../../aperture.config';

/**
 * Server Actions behind the in-map Settings → API tab: the map's user API
 * switch and scopes (`api_manage`), and minting, listing and revoking the
 * per-map read-only bearer tokens any viewer may hold.
 *
 * A token belongs to an account, not a character: the session's `userId` owns
 * it, the session character is the audit actor, and wherever an owner is shown
 * or recorded it is the account's current main. The raw token leaves the
 * server exactly once, in the mint result; only its sha256 digest is stored and
 * no event payload carries the token, its hash or its prefix.
 *
 * Every auth-cache invalidation runs after its transaction commits, so a
 * request resolving in between cannot cache the pre-change row under the new
 * generation.
 */

const mapIdSchema = z.string().regex(/^\d+$/, 'Invalid map id.');
const tokenIdSchema = z.string().regex(/^\d+$/, 'Invalid token id.');
const scopesSchema = z.array(z.enum(apiScope.enumValues));

const NOT_FOUND = 'API token not found.';

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

/** Deduplicated, in `api_scope` enum order. */
function normaliseScopes(scopes: readonly ApiScope[]): ApiScope[] {
  const set = new Set(scopes);
  return apiScope.enumValues.filter((s) => set.has(s));
}

function blockOf(
  account: {
    apiBlockedAt: Date | null;
    apiBlockedUntil: Date | null;
    apiBlockReason: string | null;
  },
  now: Date,
): UserApiAccountBlock | null {
  if (!isUserApiAccountBlocked(account, now)) return null;
  return {
    reason: account.apiBlockReason,
    until: account.apiBlockedUntil?.toISOString() ?? null,
  };
}

function liveTokenPredicate(now: Date): SQL {
  return and(
    isNull(apMapApiToken.revokedAt),
    or(isNull(apMapApiToken.expiresAt), gt(apMapApiToken.expiresAt, now)),
  )!;
}

/** Non-revoked tokens with their map's API state, their owning account's block columns and current main. */
function selectTokenRows(where: SQL) {
  return db
    .select({
      id: apMapApiToken.id,
      mapId: apMapApiToken.mapId,
      mapName: apMap.name,
      mapDeletedAt: apMap.deletedAt,
      mapApiEnabled: apMap.apiEnabled,
      userId: apMapApiToken.userId,
      label: apMapApiToken.label,
      prefix: apMapApiToken.tokenPrefix,
      scopes: apMapApiToken.scopes,
      createdAt: apMapApiToken.createdAt,
      expiresAt: apMapApiToken.expiresAt,
      lastUsedAt: apMapApiToken.lastUsedAt,
      requestCount: apMapApiToken.requestCount,
      suspendedUntil: apMapApiToken.suspendedUntil,
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
    .where(and(isNull(apMapApiToken.revokedAt), where))
    .orderBy(desc(apMapApiToken.createdAt), desc(apMapApiToken.id));
}

type TokenRow = Awaited<ReturnType<typeof selectTokenRows>>[number];

type AccountMain = Pick<TokenRow, 'mainId' | 'mainStatus' | 'mainCorporationId' | 'mainAllianceId'>;

/**
 * Whether an account's main would pass the access step of the API's decision
 * on a map: an active main that `canViewMap` admits and the login gate lets in.
 */
async function mainCanUseMap(main: AccountMain, mapId: bigint): Promise<boolean> {
  const mainId = main.mainId;
  if (mainId === null || main.mainStatus !== 'active') return false;
  const [view, login] = await Promise.all([
    canViewMap(mainId, mapId),
    isLoginAllowed({
      characterId: mainId,
      corporationId: main.mainCorporationId,
      allianceId: main.mainAllianceId,
    }),
  ]);
  return view && login;
}

/** `mainCanUseMap` for a token's owner, one evaluation per (account, map) shared through `memo`. */
function ownerCanUse(row: TokenRow, memo: Map<string, Promise<boolean>>): Promise<boolean> {
  const key = `${row.userId}:${row.mapId}`;
  let pending = memo.get(key);
  if (!pending) {
    pending = mainCanUseMap(row, row.mapId);
    memo.set(key, pending);
  }
  return pending;
}

/** The computed status, in the order the API's own decision applies them. */
async function statusOf(
  row: TokenRow,
  now: Date,
  memo: Map<string, Promise<boolean>>,
): Promise<UserApiTokenStatus> {
  if (row.expiresAt !== null && row.expiresAt <= now) return 'expired';
  if (row.mapDeletedAt !== null) return 'map_deleted';
  if (isUserApiAccountBlocked(row, now)) return 'blocked';
  if (row.suspendedUntil !== null && row.suspendedUntil > now) return 'suspended';
  if (!row.mapApiEnabled) return 'api_disabled';
  return (await ownerCanUse(row, memo)) ? 'active' : 'lost_access';
}

async function toListItems(
  rows: TokenRow[],
  viewerUserId: number,
  now: Date,
): Promise<UserApiTokenListItem[]> {
  const memo = new Map<string, Promise<boolean>>();
  return Promise.all(
    rows.map(async (row) => {
      const status = await statusOf(row, now, memo);
      return {
        id: row.id.toString(),
        mapId: row.mapId.toString(),
        mapName: row.mapName,
        label: row.label,
        prefix: row.prefix,
        scopes: normaliseScopes(row.scopes),
        ownerName: row.mainName,
        own: row.userId === viewerUserId,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        requestCount: row.requestCount.toString(),
        status,
        suspendedUntil: status === 'suspended' ? row.suspendedUntil!.toISOString() : null,
      };
    }),
  );
}

/**
 * The API tab's state for one map and the signed-in viewer: the instance and
 * map switches, the map's scopes, the viewer's account block, the account's
 * own tokens on the map and, for a holder of `api_manage`, every token on it.
 */
export async function getMapApiState(mapId: string): Promise<ActionResult<MapApiState>> {
  const parsed = mapIdSchema.safeParse(mapId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const id = BigInt(parsed.data);

  const session = await requireSession();
  const guard = await requireMapView(session, id);
  if (!guard.ok) return { ok: false, error: guard.error };

  const now = new Date();
  const [canManage, instanceEnabled, [map], [account], [live], rows] = await Promise.all([
    canUseMapFeature(guard.characterId, id, 'api_manage'),
    isUserApiInstanceEnabled(),
    db
      .select({ apiEnabled: apMap.apiEnabled, apiScopes: apMap.apiScopes })
      .from(apMap)
      .where(eq(apMap.id, id)),
    db
      .select({
        apiBlockedAt: apUser.apiBlockedAt,
        apiBlockedUntil: apUser.apiBlockedUntil,
        apiBlockReason: apUser.apiBlockReason,
      })
      .from(apUser)
      .where(eq(apUser.id, session.userId)),
    db
      .select({ n: count() })
      .from(apMapApiToken)
      .where(and(eq(apMapApiToken.userId, session.userId), liveTokenPredicate(now))),
    selectTokenRows(eq(apMapApiToken.mapId, id)),
  ]);
  if (!map) return { ok: false, error: 'Map not found.' };

  const visible = canManage ? rows : rows.filter((r) => r.userId === session.userId);
  const items = await toListItems(visible, session.userId, now);

  return {
    ok: true,
    data: {
      instanceEnabled,
      apiEnabled: map.apiEnabled,
      apiScopes: normaliseScopes(map.apiScopes),
      canManage,
      block: account ? blockOf(account, now) : null,
      ownTokens: items.filter((t) => t.own),
      mapTokens: canManage ? items : null,
      limits: {
        perMap: apertureConfig.USER_API_MAX_TOKENS_PER_ACCOUNT_PER_MAP,
        perAccount: apertureConfig.USER_API_MAX_TOKENS_PER_ACCOUNT,
        liveOnAccount: live?.n ?? 0,
      },
    },
  };
}

/**
 * The Account Settings API tokens section's state: the instance switch, the
 * signed-in account's block, and every non-revoked token the account owns on
 * any map, including maps it can no longer view, maps whose API is off and
 * soft-deleted maps, each with its computed status. Gated only by the session:
 * an account may always see its own tokens.
 */
export async function getAccountApiTokens(): Promise<ActionResult<AccountApiState>> {
  const session = await requireSession();
  const now = new Date();
  const [instanceEnabled, [account], rows] = await Promise.all([
    isUserApiInstanceEnabled(),
    db
      .select({
        apiBlockedAt: apUser.apiBlockedAt,
        apiBlockedUntil: apUser.apiBlockedUntil,
        apiBlockReason: apUser.apiBlockReason,
      })
      .from(apUser)
      .where(eq(apUser.id, session.userId)),
    selectTokenRows(eq(apMapApiToken.userId, session.userId)),
  ]);
  return {
    ok: true,
    data: {
      instanceEnabled,
      block: account ? blockOf(account, now) : null,
      tokens: await toListItems(rows, session.userId, now),
    },
  };
}

const settingsSchema = z.object({
  mapId: mapIdSchema,
  enabled: z.boolean(),
  scopes: scopesSchema,
});

/**
 * Save the map's API switch and exposed scopes, as one event: a flipped switch
 * is `api.enabled` (carrying the scopes it was enabled with) or `api.disabled`;
 * a scope edit with the switch unchanged is `api.scopes_changed`. A save that
 * changes nothing commits nothing. A save that turns the API off may not also
 * change the scopes, since `api.disabled` carries none.
 */
export async function updateMapApiSettings(
  input: z.input<typeof settingsSchema>,
): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const mapId = BigInt(parsed.data.mapId);
  const enabled = parsed.data.enabled;
  const scopes = normaliseScopes(parsed.data.scopes);

  const session = await requireSession();
  const guard = await requireMapCapability(session, mapId, 'api_manage');
  if (!guard.ok) return { ok: false, error: guard.error };
  const actorId = guard.characterId;

  let eventId: number | null;
  try {
    eventId = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ apiEnabled: apMap.apiEnabled, apiScopes: apMap.apiScopes })
        .from(apMap)
        .where(eq(apMap.id, mapId))
        .for('update');
      if (!current) throw new Error('Map not found.');

      const before = new Set(current.apiScopes);
      const added = scopes.filter((s) => !before.has(s));
      const removed = normaliseScopes(current.apiScopes).filter((s) => !scopes.includes(s));
      const scopesChanged = added.length > 0 || removed.length > 0;

      if (current.apiEnabled === enabled) {
        if (!scopesChanged) return null;
        const committed = await commitMapEvent({
          tx,
          mapId,
          characterId: actorId,
          kind: 'api.scopes_changed',
          mutate: async (tx) => {
            await tx.update(apMap).set({ apiScopes: scopes }).where(eq(apMap.id, mapId));
            return { added, removed };
          },
        });
        if (!committed.ok) throw new Error(committed.error);
        return committed.eventId;
      }

      if (enabled) {
        const committed = await commitMapEvent({
          tx,
          mapId,
          characterId: actorId,
          kind: 'api.enabled',
          mutate: async (tx) => {
            await tx
              .update(apMap)
              .set({ apiEnabled: true, apiScopes: scopes })
              .where(eq(apMap.id, mapId));
            return { scopes };
          },
        });
        if (!committed.ok) throw new Error(committed.error);
        return committed.eventId;
      }

      if (scopesChanged) {
        throw new Error('Turn the API off without changing its scopes, then save the scopes.');
      }
      const committed = await commitMapEvent({
        tx,
        mapId,
        characterId: actorId,
        kind: 'api.disabled',
        mutate: async (tx) => {
          await tx.update(apMap).set({ apiEnabled: false }).where(eq(apMap.id, mapId));
          return {};
        },
      });
      if (!committed.ok) throw new Error(committed.error);
      return committed.eventId;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save.' };
  }
  if (eventId === null) return { ok: true };

  invalidateUserApiMap(mapId);
  await enqueueWebhookDispatch(mapId, eventId, new Date());
  return { ok: true };
}

const EXPIRY_DAYS = [30, 90, 365] as const;
const DAY_MS = 86_400_000;

const createSchema = z.object({
  mapId: mapIdSchema,
  label: z.string().trim().min(1, 'Label is required.').max(60, 'Label is too long.'),
  scopes: scopesSchema.min(1, 'Choose at least one scope.'),
  /** Days from now, resolved server-side; null for no expiry. */
  expiresInDays: z
    .number()
    .refine((d) => (EXPIRY_DAYS as readonly number[]).includes(d), 'Invalid expiry.')
    .nullable(),
});

/**
 * Mint a token for the signed-in account on one map. Refused while the
 * instance or the map has the API off, when the account's main would fail the
 * API's access step on the map, while the account is blocked, for a
 * scope the map does not expose, and at either live-token cap. The caps are
 * counted under a lock on the account row, so concurrent mints cannot pass
 * them together. Commits `api.token_created`.
 *
 * **Returns:** the raw token, the only time it is ever returned.
 */
export async function createMapApiToken(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ token: string; tokenId: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const mapId = BigInt(parsed.data.mapId);
  const { label, expiresInDays } = parsed.data;
  const scopes = normaliseScopes(parsed.data.scopes);

  const session = await requireSession();
  const guard = await requireMapView(session, mapId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const actorId = guard.characterId;
  const userId = session.userId;

  if (!(await isUserApiInstanceEnabled())) {
    return { ok: false, error: 'The API is turned off on this instance.' };
  }

  // The session can sit on an alt; the token is judged by the account's main.
  const [main] = await db
    .select({
      mainId: apCharacter.id,
      mainStatus: apCharacter.status,
      mainCorporationId: apCharacter.corporationId,
      mainAllianceId: apCharacter.allianceId,
    })
    .from(apUser)
    .leftJoin(
      apCharacter,
      and(eq(apCharacter.id, apUser.mainCharacterId), eq(apCharacter.userId, apUser.id)),
    )
    .where(eq(apUser.id, userId));
  if (!main || !(await mainCanUseMap(main, mapId))) {
    return { ok: false, error: "Your account's main character cannot use the API on this map." };
  }

  const { token, hash, prefix } = generateUserApiToken();
  const now = new Date();
  const expiresAt =
    expiresInDays === null ? null : new Date(now.getTime() + expiresInDays * DAY_MS);

  const result = await commitMapEvent({
    mapId,
    characterId: actorId,
    kind: 'api.token_created',
    mutate: async (tx) => {
      const [account] = await tx
        .select({
          apiBlockedAt: apUser.apiBlockedAt,
          apiBlockedUntil: apUser.apiBlockedUntil,
        })
        .from(apUser)
        .where(eq(apUser.id, userId))
        .for('update');
      if (!account) throw new Error('Account not found.');
      if (isUserApiAccountBlocked(account, now)) {
        throw new Error('API access is blocked for your account.');
      }

      const [map] = await tx
        .select({ apiEnabled: apMap.apiEnabled, apiScopes: apMap.apiScopes })
        .from(apMap)
        .where(eq(apMap.id, mapId));
      if (!map?.apiEnabled) throw new Error('The API is turned off on this map.');
      const exposed = new Set(map.apiScopes);
      if (scopes.some((s) => !exposed.has(s))) {
        throw new Error('This map does not expose every scope you chose.');
      }

      const [onMap] = await tx
        .select({ n: count() })
        .from(apMapApiToken)
        .where(
          and(
            eq(apMapApiToken.userId, userId),
            eq(apMapApiToken.mapId, mapId),
            liveTokenPredicate(now),
          ),
        );
      if ((onMap?.n ?? 0) >= apertureConfig.USER_API_MAX_TOKENS_PER_ACCOUNT_PER_MAP) {
        throw new Error(
          `You already have ${apertureConfig.USER_API_MAX_TOKENS_PER_ACCOUNT_PER_MAP} live tokens on this map. Revoke one first.`,
        );
      }
      const [onAccount] = await tx
        .select({ n: count() })
        .from(apMapApiToken)
        .where(and(eq(apMapApiToken.userId, userId), liveTokenPredicate(now)));
      if ((onAccount?.n ?? 0) >= apertureConfig.USER_API_MAX_TOKENS_PER_ACCOUNT) {
        throw new Error(
          `Your account already has ${apertureConfig.USER_API_MAX_TOKENS_PER_ACCOUNT} live tokens. Revoke one first.`,
        );
      }

      const [row] = await tx
        .insert(apMapApiToken)
        .values({ mapId, userId, tokenHash: hash, tokenPrefix: prefix, label, scopes, expiresAt })
        .returning({ id: apMapApiToken.id });
      return {
        tokenId: row!.id.toString(),
        label,
        scopes,
        expiresAt: expiresAt?.toISOString() ?? null,
      };
    },
  });

  if (!result.ok) return { ok: false, error: result.error };
  if (result.data.kind !== 'api.token_created') return { ok: false, error: 'Mint failed.' };
  return { ok: true, data: { token, tokenId: result.data.tokenId } };
}

/**
 * Revoke a token. The owning account may always revoke its own (`creator`);
 * anyone else needs `api_manage` on the token's map (`manager`). Idempotent: an
 * already-revoked token succeeds without a second event. An unknown id and a
 * token the caller may not revoke return the identical message, since token
 * ids are sequential. Commits `api.token_revoked` naming the label and the
 * owning account's current main.
 */
export async function revokeMapApiToken(tokenId: string): Promise<ActionResult> {
  const parsed = tokenIdSchema.safeParse(tokenId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const id = BigInt(parsed.data);

  const session = await requireSession();
  const [token] = await db
    .select({ mapId: apMapApiToken.mapId, userId: apMapApiToken.userId })
    .from(apMapApiToken)
    .where(eq(apMapApiToken.id, id));
  if (!token) return { ok: false, error: NOT_FOUND };

  let reason: 'creator' | 'manager';
  let actorId: bigint;
  if (token.userId === session.userId) {
    reason = 'creator';
    actorId = BigInt(session.characterId);
  } else {
    const guard = await requireMapCapability(session, token.mapId, 'api_manage');
    if (!guard.ok) return { ok: false, error: NOT_FOUND };
    reason = 'manager';
    actorId = guard.characterId;
  }

  let eventId: number | null;
  try {
    eventId = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          label: apMapApiToken.label,
          revokedAt: apMapApiToken.revokedAt,
          mainId: apCharacter.id,
          mainName: apCharacter.name,
        })
        .from(apMapApiToken)
        .innerJoin(apUser, eq(apUser.id, apMapApiToken.userId))
        .leftJoin(
          apCharacter,
          and(eq(apCharacter.id, apUser.mainCharacterId), eq(apCharacter.userId, apUser.id)),
        )
        .where(eq(apMapApiToken.id, id))
        .for('update', { of: [apMapApiToken] });
      if (!row || row.revokedAt !== null) return null;

      const committed = await commitMapEvent({
        tx,
        mapId: token.mapId,
        characterId: actorId,
        kind: 'api.token_revoked',
        mutate: async (tx) => {
          await tx
            .update(apMapApiToken)
            .set({ revokedAt: new Date(), revokedReason: reason, revokedByCharacterId: actorId })
            .where(eq(apMapApiToken.id, id));
          return {
            tokenId: id.toString(),
            label: row.label,
            ownerCharacterId: row.mainId === null ? null : Number(row.mainId),
            ownerName: row.mainName,
            reason,
          };
        },
      });
      if (!committed.ok) throw new Error(committed.error);
      return committed.eventId;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not revoke.' };
  }
  if (eventId === null) return { ok: true };

  invalidateUserApiToken(id);
  await enqueueWebhookDispatch(token.mapId, eventId, new Date());
  return { ok: true };
}
