// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apCharacterRole,
  apCorporation,
  apInstance,
  apInstanceOwner,
  apMap,
  apMapApiToken,
  apMapEvent,
  apMapRoleAccess,
  apRole,
  apUser,
} from '@/db/schema';
import {
  authorizeUserApiBearer,
  checkUserApiScope,
  clearUserApiAuthCache,
} from '@/lib/userApi/authorize';
import { invalidateUserApiInstanceSwitch } from '@/lib/userApi/instance';
import { generateUserApiToken, hashUserApiToken } from '@/lib/userApi/token';
import type { ApiScope } from '@/types';
import { apertureConfig } from '../../aperture.config';

/**
 * The Map Settings → API tab's Server Actions (`src/app/(app)/actions/mapApi.ts`)
 * against real Postgres, with `requireSession` mocked. `ap_instance` is a live
 * singleton: its access mode and user API switch are snapshotted and restored.
 * The test corp owns the instance, so its members pass the login gate and each
 * refusal below has exactly one cause. Ids use a 9737xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-map-actions
 */
const run = process.env.RUN_DB_TESTS === '1';

const h = vi.hoisted(() => ({ characterId: '0', userId: 0 }));
vi.mock('@/lib/session', () => ({
  requireSession: async () => ({ characterId: h.characterId, userId: h.userId }),
}));

const { createMapApiToken, getMapApiState, revokeMapApiToken, updateMapApiSettings } =
  await import('@/app/(app)/actions/mapApi');

const CORP = 97379001n;
const OTHER_CORP = 97379002n;
const DIRECTOR = 97370001n;
const MEMBER = 97370002n;
const MEMBER_ALT = 97370003n;
const DELEGATE = 97370004n;
const OUTSIDER = 97370005n;
const TITLE = 97378001n;
const MAP_NAME = 'User API Actions Map';
const OTHER_MAP_NAME = 'User API Actions Other Map';
const CHARACTERS = [DIRECTOR, MEMBER, MEMBER_ALT, DELEGATE, OUTSIDER];

const users = { director: 0, member: 0, delegate: 0, outsider: 0 };
let mapId = 0n;
let otherMapId = 0n;
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

function actAs(characterId: bigint, userId: number): void {
  h.characterId = characterId.toString();
  h.userId = userId;
}

async function insertToken(
  userId: number,
  opts: {
    map?: bigint;
    scopes?: ApiScope[];
    expiresAt?: Date | null;
    revokedAt?: Date | null;
  } = {},
): Promise<{ id: bigint; token: string }> {
  const { token, hash, prefix } = generateUserApiToken();
  const [row] = await db
    .insert(apMapApiToken)
    .values({
      mapId: opts.map ?? mapId,
      userId,
      tokenHash: hash,
      tokenPrefix: prefix,
      label: 'seeded',
      scopes: opts.scopes ?? ['map'],
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revokedAt ?? null,
    })
    .returning({ id: apMapApiToken.id });
  return { id: row!.id, token };
}

async function events() {
  return db
    .select({
      kind: apMapEvent.kind,
      characterId: apMapEvent.characterId,
      payload: apMapEvent.payload,
    })
    .from(apMapEvent)
    .where(eq(apMapEvent.mapId, mapId))
    .orderBy(asc(apMapEvent.id));
}

async function setMapApi(enabled: boolean, scopes: ApiScope[]): Promise<void> {
  await db.update(apMap).set({ apiEnabled: enabled, apiScopes: scopes }).where(eq(apMap.id, mapId));
}

function mint(scopes: ApiScope[] = ['map'], label = 'my tool') {
  return createMapApiToken({ mapId: mapId.toString(), label, scopes, expiresInDays: 90 });
}

describe.skipIf(!run)('map API actions (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();

    await db
      .insert(apInstance)
      .values({ id: 1, accessMode: 'restricted', userApiEnabled: true })
      .onConflictDoUpdate({
        target: apInstance.id,
        set: { accessMode: 'restricted', userApiEnabled: true },
      });
    await db
      .insert(apInstanceOwner)
      .values({ principalKind: 'corporation', principalId: CORP })
      .onConflictDoNothing();
    await db.insert(apCorporation).values([
      { id: CORP, name: 'User API Actions Corp' },
      { id: OTHER_CORP, name: 'User API Actions Elsewhere' },
    ]);

    for (const key of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
      users[key] = u!.id;
    }
    const char = (id: bigint, userId: number, name: string, corp: bigint, isDirector = false) => ({
      id,
      userId,
      name,
      ownerHash: `user-api-actions-${id}`,
      authzLevel: 'member' as const,
      corporationId: corp,
      allianceId: null,
      isDirector,
      status: 'active' as const,
    });
    await db
      .insert(apCharacter)
      .values([
        char(DIRECTOR, users.director, 'Actions Director', CORP, true),
        char(MEMBER, users.member, 'Actions Member', CORP),
        char(MEMBER_ALT, users.member, 'Actions Member Alt', CORP),
        char(DELEGATE, users.delegate, 'Actions Delegate', CORP),
        char(OUTSIDER, users.outsider, 'Actions Outsider', OTHER_CORP),
      ]);
    await db.update(apUser).set({ mainCharacterId: DIRECTOR }).where(eq(apUser.id, users.director));
    await db.update(apUser).set({ mainCharacterId: MEMBER }).where(eq(apUser.id, users.member));
    await db.update(apUser).set({ mainCharacterId: DELEGATE }).where(eq(apUser.id, users.delegate));
    await db.update(apUser).set({ mainCharacterId: OUTSIDER }).where(eq(apUser.id, users.outsider));

    const maps = await db
      .insert(apMap)
      .values([
        { name: MAP_NAME, scope: 'wh', type: 'corp', ownerCorporationId: CORP },
        { name: OTHER_MAP_NAME, scope: 'wh', type: 'corp', ownerCorporationId: CORP },
      ])
      .returning({ id: apMap.id, name: apMap.name });
    mapId = maps.find((m) => m.name === MAP_NAME)!.id;
    otherMapId = maps.find((m) => m.name === OTHER_MAP_NAME)!.id;

    await db.insert(apRole).values({
      id: TITLE,
      source: 'corp_title',
      externalRef: `${CORP}:20`,
      name: 'API Wranglers',
      corporationId: CORP,
    });
    await db
      .insert(apCharacterRole)
      .values({ characterId: DELEGATE, roleId: TITLE, grantedBy: 'corp-title-sync' });
    await db.insert(apMapRoleAccess).values({ mapId, roleId: TITLE, capability: 'api_manage' });
  });

  beforeEach(async () => {
    clearUserApiAuthCache();
    invalidateUserApiInstanceSwitch();
    await db.update(apInstance).set({ userApiEnabled: true }).where(eq(apInstance.id, 1));
    await db.delete(apMapEvent).where(eq(apMapEvent.mapId, mapId));
    await db.delete(apMapApiToken).where(inArray(apMapApiToken.mapId, [mapId, otherMapId]));
    await setMapApi(true, ['map', 'signatures', 'pilots']);
    await db
      .update(apUser)
      .set({ apiBlockedAt: null, apiBlockedUntil: null, apiBlockReason: null })
      .where(inArray(apUser.id, Object.values(users)));
  });

  afterAll(async () => {
    clearUserApiAuthCache();
    invalidateUserApiInstanceSwitch();
    await cleanup();
    if (instanceSnapshot) {
      await db
        .update(apInstance)
        .set({
          accessMode: instanceSnapshot.accessMode,
          userApiEnabled: instanceSnapshot.userApiEnabled,
        })
        .where(eq(apInstance.id, 1));
    }
    await pool.end();
  });

  describe('updateMapApiSettings', () => {
    it('needs api_manage: a plain member is refused and nothing is written', async () => {
      await setMapApi(false, []);
      actAs(MEMBER, users.member);
      const result = await updateMapApiSettings({
        mapId: mapId.toString(),
        enabled: true,
        scopes: ['map'],
      });
      expect(result).toEqual({ ok: false, error: 'Forbidden.' });
      expect(await events()).toEqual([]);
      const [m] = await db
        .select({ apiEnabled: apMap.apiEnabled })
        .from(apMap)
        .where(eq(apMap.id, mapId));
      expect(m!.apiEnabled).toBe(false);
    });

    it('lets a title-delegated holder enable the API, as one api.enabled event', async () => {
      await setMapApi(false, []);
      actAs(DELEGATE, users.delegate);
      const result = await updateMapApiSettings({
        mapId: mapId.toString(),
        enabled: true,
        scopes: ['signatures', 'map', 'map'],
      });
      expect(result).toEqual({ ok: true });
      const [m] = await db
        .select({ apiEnabled: apMap.apiEnabled, apiScopes: apMap.apiScopes })
        .from(apMap)
        .where(eq(apMap.id, mapId));
      expect(m).toEqual({ apiEnabled: true, apiScopes: ['map', 'signatures'] });
      const log = await events();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        kind: 'api.enabled',
        characterId: DELEGATE,
        payload: { scopes: ['map', 'signatures'] },
      });
    });

    it('commits a scope edit as api.scopes_changed and a no-op save as nothing', async () => {
      actAs(DIRECTOR, users.director);
      const edit = await updateMapApiSettings({
        mapId: mapId.toString(),
        enabled: true,
        scopes: ['map', 'pilots', 'kills'],
      });
      expect(edit).toEqual({ ok: true });
      const noop = await updateMapApiSettings({
        mapId: mapId.toString(),
        enabled: true,
        scopes: ['kills', 'map', 'pilots'],
      });
      expect(noop).toEqual({ ok: true });
      const log = await events();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        kind: 'api.scopes_changed',
        payload: { added: ['kills'], removed: ['signatures'] },
      });
    });

    it('refuses to change scopes in the save that turns the API off', async () => {
      actAs(DIRECTOR, users.director);
      const refused = await updateMapApiSettings({
        mapId: mapId.toString(),
        enabled: false,
        scopes: ['map'],
      });
      expect(refused.ok).toBe(false);
      expect(await events()).toEqual([]);

      const off = await updateMapApiSettings({
        mapId: mapId.toString(),
        enabled: false,
        scopes: ['map', 'signatures', 'pilots'],
      });
      expect(off).toEqual({ ok: true });
      const log = await events();
      expect(log.map((e) => e.kind)).toEqual(['api.disabled']);
      const [m] = await db
        .select({ apiEnabled: apMap.apiEnabled, apiScopes: apMap.apiScopes })
        .from(apMap)
        .where(eq(apMap.id, mapId));
      expect(m).toEqual({ apiEnabled: false, apiScopes: ['map', 'signatures', 'pilots'] });
    });

    it('invalidates the auth cache, so the next request sees the switch', async () => {
      const { token } = await insertToken(users.member);
      expect((await authorizeUserApiBearer(`Bearer ${token}`)).ok).toBe(true);

      actAs(DIRECTOR, users.director);
      await updateMapApiSettings({
        mapId: mapId.toString(),
        enabled: false,
        scopes: ['map', 'signatures', 'pilots'],
      });
      expect(await authorizeUserApiBearer(`Bearer ${token}`)).toMatchObject({
        ok: false,
        code: 'api_disabled',
      });
    });

    it('invalidates the auth cache, so the next request sees a removed scope', async () => {
      const { token } = await insertToken(users.member, { scopes: ['map', 'signatures'] });
      const before = await authorizeUserApiBearer(`Bearer ${token}`);
      expect(before.ok).toBe(true);
      if (!before.ok) return;
      expect(checkUserApiScope(before.record, 'signatures').ok).toBe(true);

      actAs(DIRECTOR, users.director);
      await updateMapApiSettings({
        mapId: mapId.toString(),
        enabled: true,
        scopes: ['map', 'pilots'],
      });
      const after = await authorizeUserApiBearer(`Bearer ${token}`);
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(checkUserApiScope(after.record, 'signatures')).toMatchObject({
        ok: false,
        code: 'scope_not_granted',
      });
    });
  });

  describe('createMapApiToken', () => {
    it('mints for the account, returning the raw token only in the result', async () => {
      actAs(MEMBER_ALT, users.member);
      const result = await mint(['map', 'pilots']);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { token, tokenId } = result.data;
      expect(token).toMatch(/^apu_[A-Za-z0-9_-]{43}$/);

      const [row] = await db
        .select()
        .from(apMapApiToken)
        .where(eq(apMapApiToken.id, BigInt(tokenId)));
      expect(row).toMatchObject({
        userId: users.member,
        tokenHash: hashUserApiToken(token),
        tokenPrefix: token.slice(4, 10),
        label: 'my tool',
        scopes: ['map', 'pilots'],
      });
      const days = (row!.expiresAt!.getTime() - row!.createdAt.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(90);

      const log = await events();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        kind: 'api.token_created',
        characterId: MEMBER_ALT,
        payload: { tokenId, label: 'my tool', scopes: ['map', 'pilots'] },
      });
      const serialised = JSON.stringify(log.map((e) => e.payload));
      expect(serialised).not.toContain(token);
      expect(serialised).not.toContain(row!.tokenHash);
      expect(serialised).not.toContain(row!.tokenPrefix);

      // The token is the account's: the same list from the main, owned by the main.
      actAs(MEMBER, users.member);
      const state = await getMapApiState(mapId.toString());
      expect(state.ok).toBe(true);
      if (!state.ok) return;
      expect(JSON.stringify(state.data)).not.toContain(token);
      expect(state.data.ownTokens.map((t) => t.id)).toEqual([tokenId]);
      expect(state.data.ownTokens[0]).toMatchObject({
        ownerName: 'Actions Member',
        status: 'active',
      });
    });

    it('is refused while the map has the API off', async () => {
      await setMapApi(false, ['map']);
      actAs(MEMBER, users.member);
      expect(await mint()).toEqual({ ok: false, error: 'The API is turned off on this map.' });
    });

    it('is refused while the instance has the API off', async () => {
      await db.update(apInstance).set({ userApiEnabled: false }).where(eq(apInstance.id, 1));
      invalidateUserApiInstanceSwitch();
      actAs(MEMBER, users.member);
      expect(await mint()).toEqual({ ok: false, error: 'The API is turned off on this instance.' });
    });

    it('is refused while the account is blocked', async () => {
      await db
        .update(apUser)
        .set({ apiBlockedAt: new Date(), apiBlockedUntil: null, apiBlockReason: 'test' })
        .where(eq(apUser.id, users.member));
      actAs(MEMBER, users.member);
      expect(await mint()).toEqual({ ok: false, error: 'API access is blocked for your account.' });
    });

    it('is refused for a scope the map does not expose', async () => {
      actAs(MEMBER, users.member);
      const result = await mint(['map', 'notes']);
      expect(result).toEqual({
        ok: false,
        error: 'This map does not expose every scope you chose.',
      });
    });

    it('is refused at the per-map cap, counting only live tokens', async () => {
      const cap = apertureConfig.USER_API_MAX_TOKENS_PER_ACCOUNT_PER_MAP;
      await insertToken(users.member, { expiresAt: new Date(Date.now() - 60_000) });
      await insertToken(users.member, { revokedAt: new Date() });
      for (let i = 0; i < cap - 1; i++) await insertToken(users.member);
      actAs(MEMBER, users.member);
      expect((await mint()).ok).toBe(true);
      const refused = await mint();
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error).toContain('on this map');
    });

    it("is judged by the account's main: an alt that views the map cannot mint for a main that does not", async () => {
      // OTHER_CORP is made an instance owner so the main still passes the login
      // gate and `canViewMap` is the only refusal.
      await db
        .insert(apInstanceOwner)
        .values({ principalKind: 'corporation', principalId: OTHER_CORP })
        .onConflictDoNothing();
      await db
        .update(apCharacter)
        .set({ corporationId: OTHER_CORP })
        .where(eq(apCharacter.id, MEMBER));
      try {
        actAs(MEMBER_ALT, users.member);
        expect(await mint()).toEqual({
          ok: false,
          error: "Your account's main character cannot use the API on this map.",
        });
        expect(
          await db.select().from(apMapApiToken).where(eq(apMapApiToken.userId, users.member)),
        ).toHaveLength(0);
        expect(await events()).toHaveLength(0);
      } finally {
        await db.update(apCharacter).set({ corporationId: CORP }).where(eq(apCharacter.id, MEMBER));
        await db
          .delete(apInstanceOwner)
          .where(
            and(
              eq(apInstanceOwner.principalKind, 'corporation'),
              eq(apInstanceOwner.principalId, OTHER_CORP),
            ),
          );
      }
    });

    it("is refused when the account's stored main is not active, even from an active alt", async () => {
      await db.update(apCharacter).set({ status: 'kicked' }).where(eq(apCharacter.id, MEMBER));
      try {
        actAs(MEMBER_ALT, users.member);
        expect(await mint()).toEqual({
          ok: false,
          error: "Your account's main character cannot use the API on this map.",
        });
        expect(await events()).toHaveLength(0);
      } finally {
        await db.update(apCharacter).set({ status: 'active' }).where(eq(apCharacter.id, MEMBER));
      }
    });

    it('is refused at the per-account cap across maps', async () => {
      const cap = apertureConfig.USER_API_MAX_TOKENS_PER_ACCOUNT;
      for (let i = 0; i < cap; i++) await insertToken(users.member, { map: otherMapId });
      actAs(MEMBER, users.member);
      const refused = await mint();
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error).toContain('Your account already has');
    });
  });

  describe('revokeMapApiToken', () => {
    it('revokes your own token, once, and invalidates its cached record', async () => {
      const { id, token } = await insertToken(users.member);
      expect((await authorizeUserApiBearer(`Bearer ${token}`)).ok).toBe(true);

      actAs(MEMBER_ALT, users.member);
      expect(await revokeMapApiToken(id.toString())).toEqual({ ok: true });
      const [row] = await db.select().from(apMapApiToken).where(eq(apMapApiToken.id, id));
      expect(row).toMatchObject({ revokedReason: 'creator', revokedByCharacterId: MEMBER_ALT });
      expect(row!.revokedAt).not.toBeNull();
      expect(await authorizeUserApiBearer(`Bearer ${token}`)).toMatchObject({
        ok: false,
        status: 401,
      });

      expect(await revokeMapApiToken(id.toString())).toEqual({ ok: true });
      const log = await events();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        kind: 'api.token_revoked',
        characterId: MEMBER_ALT,
        payload: {
          tokenId: id.toString(),
          label: 'seeded',
          ownerCharacterId: Number(MEMBER),
          ownerName: 'Actions Member',
          reason: 'creator',
        },
      });
      expect(JSON.stringify(log.map((e) => e.payload))).not.toContain(token);
    });

    it("refuses someone else's token without api_manage, exactly as for an unknown id", async () => {
      const { id } = await insertToken(users.director);
      actAs(MEMBER, users.member);
      const forbidden = await revokeMapApiToken(id.toString());
      const unknown = await revokeMapApiToken('999999999999');
      expect(forbidden).toEqual({ ok: false, error: 'API token not found.' });
      expect(unknown).toEqual(forbidden);
      const [row] = await db.select().from(apMapApiToken).where(eq(apMapApiToken.id, id));
      expect(row!.revokedAt).toBeNull();
      expect(await events()).toEqual([]);
    });

    it("lets an api_manage holder revoke someone else's token as manager", async () => {
      const { id } = await insertToken(users.member);
      actAs(DELEGATE, users.delegate);
      expect(await revokeMapApiToken(id.toString())).toEqual({ ok: true });
      const [row] = await db.select().from(apMapApiToken).where(eq(apMapApiToken.id, id));
      expect(row).toMatchObject({ revokedReason: 'manager', revokedByCharacterId: DELEGATE });
      const log = await events();
      expect(log[0]).toMatchObject({
        kind: 'api.token_revoked',
        payload: { ownerName: 'Actions Member', reason: 'manager' },
      });
    });
  });

  describe('getMapApiState', () => {
    it('gives a viewer only their own tokens and a manager every token with its status', async () => {
      const mine = await insertToken(users.member);
      const suspended = await insertToken(users.director);
      await db
        .update(apMapApiToken)
        .set({ suspendedUntil: new Date(Date.now() + 600_000) })
        .where(eq(apMapApiToken.id, suspended.id));
      const lost = await insertToken(users.outsider);
      const blocked = await insertToken(users.delegate);
      await db
        .update(apUser)
        .set({ apiBlockedAt: new Date(), apiBlockedUntil: null, apiBlockReason: 'by hand' })
        .where(eq(apUser.id, users.delegate));

      actAs(MEMBER, users.member);
      const viewer = await getMapApiState(mapId.toString());
      expect(viewer.ok).toBe(true);
      if (!viewer.ok) return;
      expect(viewer.data).toMatchObject({
        instanceEnabled: true,
        apiEnabled: true,
        apiScopes: ['map', 'signatures', 'pilots'],
        canManage: false,
        block: null,
        mapTokens: null,
      });
      expect(viewer.data.ownTokens.map((t) => t.id)).toEqual([mine.id.toString()]);

      actAs(DIRECTOR, users.director);
      const manager = await getMapApiState(mapId.toString());
      expect(manager.ok).toBe(true);
      if (!manager.ok) return;
      expect(manager.data.canManage).toBe(true);
      const byId = new Map(manager.data.mapTokens!.map((t) => [t.id, t]));
      expect(byId.get(mine.id.toString())).toMatchObject({
        status: 'active',
        ownerName: 'Actions Member',
      });
      expect(byId.get(suspended.id.toString())).toMatchObject({ status: 'suspended', own: true });
      expect(byId.get(suspended.id.toString())!.suspendedUntil).not.toBeNull();
      expect(byId.get(lost.id.toString())).toMatchObject({ status: 'lost_access' });
      expect(byId.get(blocked.id.toString())).toMatchObject({ status: 'blocked' });

      actAs(DELEGATE, users.delegate);
      const blockedView = await getMapApiState(mapId.toString());
      expect(blockedView.ok).toBe(true);
      if (!blockedView.ok) return;
      expect(blockedView.data.block).toEqual({ reason: 'by hand', until: null });
    });
  });
});

async function cleanup() {
  await db.delete(apMap).where(inArray(apMap.name, [MAP_NAME, OTHER_MAP_NAME]));
  await db.delete(apCharacterRole).where(eq(apCharacterRole.roleId, TITLE));
  await db.delete(apRole).where(eq(apRole.id, TITLE));
  await db
    .delete(apInstanceOwner)
    .where(
      and(
        eq(apInstanceOwner.principalKind, 'corporation'),
        inArray(apInstanceOwner.principalId, [CORP, OTHER_CORP]),
      ),
    );
  const owners = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, CHARACTERS));
  await db.delete(apCharacter).where(inArray(apCharacter.id, CHARACTERS));
  const userIds = [...new Set([...owners.map((o) => o.userId), ...Object.values(users)])].filter(
    (id) => id !== 0,
  );
  if (userIds.length > 0) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(apCorporation).where(inArray(apCorporation.id, [CORP, OTHER_CORP]));
}
