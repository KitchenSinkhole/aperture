// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apCorporation,
  apInstance,
  apInstanceOwner,
  apMap,
  apMapApiToken,
  apUser,
} from '@/db/schema';
import {
  authorizeUserApiBearer,
  checkUserApiScope,
  clearUserApiAuthCache,
  invalidateUserApiAccount,
  invalidateUserApiMap,
  invalidateUserApiToken,
} from '@/lib/userApi/authorize';
import { generateUserApiToken } from '@/lib/userApi/token';
import { apertureConfig } from '../../aperture.config';

/**
 * User API token resolution and decision against real Postgres: a live token
 * turns into the right refusal as its owning account, its main and its map
 * change, and each explicit change is visible to the next call through the
 * invalidation exports rather than the TTL.
 *
 * `ap_instance` is a live singleton, so its access mode is snapshotted and
 * restored. Ids use a 9731xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-authorize
 */
const run = process.env.RUN_DB_TESTS === '1';

const CORP = 97319001n;
const OUTSIDE_CORP = 97319002n;
const MAIN = 97310001n;
const OUTSIDER_ALT = 97310002n; // on the same account, in a corp that cannot view the map
const corpIds = [CORP, OUTSIDE_CORP];
const characterIds = [MAIN, OUTSIDER_ALT];

const TTL = apertureConfig.USER_API_AUTH_CACHE_TTL_MS;

let userId = 0;
let mapId = 0n;
let tokenId = 0n;
let header = '';
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

describe.skipIf(!run)('User API authorization (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();

    // Restricted, with both test corps as instance owners: every character here
    // passes the login gate, so a corp move or main switch is refused by
    // canViewMap alone.
    await db
      .insert(apInstance)
      .values({ id: 1, accessMode: 'restricted' })
      .onConflictDoUpdate({ target: apInstance.id, set: { accessMode: 'restricted' } });
    await db
      .insert(apInstanceOwner)
      .values(corpIds.map((principalId) => ({ principalKind: 'corporation' as const, principalId })))
      .onConflictDoNothing();

    await db.insert(apCorporation).values([
      { id: CORP, name: 'User API Test Corp' },
      { id: OUTSIDE_CORP, name: 'User API Outside Corp' },
    ]);
    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    await db.insert(apCharacter).values([
      mkChar(MAIN, CORP),
      mkChar(OUTSIDER_ALT, OUTSIDE_CORP),
    ]);
    const [m] = await db
      .insert(apMap)
      .values({ name: 'User API Map', scope: 'wh', type: 'corp', ownerCorporationId: CORP })
      .returning({ id: apMap.id });
    mapId = m!.id;
  });

  beforeEach(async () => {
    clearUserApiAuthCache();
    await db.delete(apMapApiToken).where(eq(apMapApiToken.mapId, mapId));
    await db
      .update(apMap)
      .set({ apiEnabled: true, apiScopes: ['map', 'signatures'], deletedAt: null })
      .where(eq(apMap.id, mapId));
    await db
      .update(apUser)
      .set({ mainCharacterId: MAIN, apiBlockedAt: null, apiBlockedUntil: null, apiBlockReason: null })
      .where(eq(apUser.id, userId));
    await db
      .update(apCharacter)
      .set({ status: 'active', corporationId: CORP })
      .where(eq(apCharacter.id, MAIN));

    const { token, hash, prefix } = generateUserApiToken();
    const [t] = await db
      .insert(apMapApiToken)
      .values({
        mapId,
        userId,
        tokenHash: hash,
        tokenPrefix: prefix,
        label: 'test tool',
        scopes: ['map', 'signatures'],
      })
      .returning({ id: apMapApiToken.id });
    tokenId = t!.id;
    header = `Bearer ${token}`;
  });

  afterAll(async () => {
    clearUserApiAuthCache();
    await cleanup();
    if (instanceSnapshot) {
      await db
        .update(apInstance)
        .set({ accessMode: instanceSnapshot.accessMode })
        .where(eq(apInstance.id, 1));
    }
    await pool.end();
  });

  it('allows a live token, resolving its map and main', async () => {
    const decision = await authorizeUserApiBearer(header);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.record.token.id).toBe(tokenId);
    expect(decision.record.map).toMatchObject({ id: mapId, name: 'User API Map', apiEnabled: true });
    expect(decision.record.account).toMatchObject({ userId, mainCharacterId: MAIN });
    expect(decision.record.access).toMatchObject({ mainCanView: true, mainLoginAllowed: true });
    expect(decision.record.access?.blackout.userId).toBe(userId);
  });

  it('answers an unknown token 401', async () => {
    const { token } = generateUserApiToken();
    expect(await authorizeUserApiBearer(`Bearer ${token}`)).toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
  });

  it('answers 401 once revoked', async () => {
    const t0 = Date.now();
    expect((await authorizeUserApiBearer(header, t0)).ok).toBe(true);
    await db
      .update(apMapApiToken)
      .set({ revokedAt: new Date(), revokedReason: 'creator' })
      .where(eq(apMapApiToken.id, tokenId));
    expect((await authorizeUserApiBearer(header, t0 + 1)).ok).toBe(true);
    invalidateUserApiToken(tokenId);
    expect(await authorizeUserApiBearer(header, t0 + 2)).toMatchObject({
      status: 401,
      code: 'invalid_token',
      record: null,
    });
  });

  it('loses access within the TTL when the main is kicked', async () => {
    const t0 = Date.now();
    expect((await authorizeUserApiBearer(header, t0)).ok).toBe(true);
    await db.update(apCharacter).set({ status: 'kicked' }).where(eq(apCharacter.id, MAIN));
    expect(await authorizeUserApiBearer(header, t0 + TTL)).toMatchObject({
      status: 403,
      code: 'access_lost',
    });
  });

  it("loses access within the TTL when the main's corp changes", async () => {
    const t0 = Date.now();
    expect((await authorizeUserApiBearer(header, t0)).ok).toBe(true);
    await db
      .update(apCharacter)
      .set({ corporationId: OUTSIDE_CORP })
      .where(eq(apCharacter.id, MAIN));
    const decision = await authorizeUserApiBearer(header, t0 + TTL);
    expect(decision).toMatchObject({ status: 403, code: 'access_lost' });
    expect(decision.record?.access).toMatchObject({ mainCanView: false, mainLoginAllowed: true });
  });

  it('follows the main when the account switches it', async () => {
    const t0 = Date.now();
    expect((await authorizeUserApiBearer(header, t0)).ok).toBe(true);
    await db.update(apUser).set({ mainCharacterId: OUTSIDER_ALT }).where(eq(apUser.id, userId));
    invalidateUserApiAccount(userId);
    const decision = await authorizeUserApiBearer(header, t0 + 1);
    expect(decision).toMatchObject({ status: 403, code: 'access_lost' });
    expect(decision.record?.account.mainCharacterId).toBe(OUTSIDER_ALT);
    expect(decision.record?.access).toMatchObject({ mainCanView: false, mainLoginAllowed: true });
  });

  it('fails closed when the account has no main', async () => {
    await db.update(apUser).set({ mainCharacterId: null }).where(eq(apUser.id, userId));
    expect(await authorizeUserApiBearer(header)).toMatchObject({ status: 403, code: 'access_lost' });
  });

  it('answers api_disabled once the map turns its API off', async () => {
    const t0 = Date.now();
    expect((await authorizeUserApiBearer(header, t0)).ok).toBe(true);
    await db.update(apMap).set({ apiEnabled: false }).where(eq(apMap.id, mapId));
    expect((await authorizeUserApiBearer(header, t0 + 1)).ok).toBe(true);
    invalidateUserApiMap(mapId);
    expect(await authorizeUserApiBearer(header, t0 + 2)).toMatchObject({
      status: 403,
      code: 'api_disabled',
    });
  });

  it('refuses a scope once the map stops exposing it', async () => {
    const t0 = Date.now();
    const first = await authorizeUserApiBearer(header, t0);
    if (!first.ok) throw new Error('expected a live token');
    expect(checkUserApiScope(first.record, 'signatures').ok).toBe(true);

    await db.update(apMap).set({ apiScopes: ['map'] }).where(eq(apMap.id, mapId));
    invalidateUserApiMap(mapId);
    const next = await authorizeUserApiBearer(header, t0 + 1);
    if (!next.ok) throw new Error('expected a live token');
    expect(checkUserApiScope(next.record, 'map').ok).toBe(true);
    expect(checkUserApiScope(next.record, 'signatures')).toMatchObject({
      status: 403,
      code: 'scope_not_granted',
    });
  });

  it('answers account_blocked once the account is blocked', async () => {
    const t0 = Date.now();
    expect((await authorizeUserApiBearer(header, t0)).ok).toBe(true);
    const now = new Date(t0);
    await db
      .update(apUser)
      .set({
        apiBlockedAt: now,
        apiBlockedUntil: new Date(t0 + 7 * 86_400_000),
        apiBlockReason: 'test',
      })
      .where(eq(apUser.id, userId));
    invalidateUserApiAccount(userId);
    expect(await authorizeUserApiBearer(header, t0 + 1)).toMatchObject({
      status: 403,
      code: 'account_blocked',
    });
  });

  it('answers 401 for a token on a soft-deleted map', async () => {
    await db.update(apMap).set({ deletedAt: new Date() }).where(eq(apMap.id, mapId));
    expect(await authorizeUserApiBearer(header)).toMatchObject({ status: 401, code: 'invalid_token' });
  });
});

function mkChar(id: bigint, corporationId: bigint) {
  return {
    id,
    userId,
    name: `User API ${id.toString()}`,
    ownerHash: `user-api-hash-${id.toString()}`,
    authzLevel: 'member' as const,
    corporationId,
    allianceId: null,
    status: 'active' as const,
  };
}

async function cleanup() {
  await db.delete(apMap).where(eq(apMap.name, 'User API Map'));
  await db
    .delete(apInstanceOwner)
    .where(
      and(
        eq(apInstanceOwner.principalKind, 'corporation'),
        inArray(apInstanceOwner.principalId, corpIds),
      ),
    );
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, characterIds));
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  const userIds = [...new Set([...users.map((u) => u.userId), userId])].filter((id) => id !== 0);
  if (userIds.length > 0) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(apCorporation).where(inArray(apCorporation.id, corpIds));
}
