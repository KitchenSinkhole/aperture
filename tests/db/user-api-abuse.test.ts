// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apCorporation,
  apInstance,
  apInstanceOwner,
  apMap,
  apMapApiToken,
  apMapEvent,
  apUser,
} from '@/db/schema';
import { applyUserApiStrike } from '@/lib/userApi/abuse';
import { authorizeUserApiBearer, clearUserApiAuthCache } from '@/lib/userApi/authorize';
import { generateUserApiToken } from '@/lib/userApi/token';

/**
 * The user API abuse ladder against real Postgres: a token walks strike 1, 2
 * and 3; each transition writes its columns and exactly one `ap_map_event`,
 * and the auth cache shows it to the very next request.
 *
 * `ap_instance` is a live singleton, so its access mode is snapshotted and
 * restored. Ids use a 9732xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-abuse
 */
const run = process.env.RUN_DB_TESTS === '1';

const CORP = 97329001n;
const MAIN = 97320001n;
const MAP_NAME = 'User API Abuse Map';
const DAY = 86_400_000;
const MIN = 60_000;

let userId = 0;
let mapId = 0n;
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

describe.skipIf(!run)('User API abuse ladder (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();

    // The test corp owns the instance, so the main passes the login gate and a
    // live token's only refusals are the ones the ladder causes.
    await db
      .insert(apInstance)
      .values({ id: 1, accessMode: 'restricted' })
      .onConflictDoUpdate({ target: apInstance.id, set: { accessMode: 'restricted' } });
    await db
      .insert(apInstanceOwner)
      .values({ principalKind: 'corporation', principalId: CORP })
      .onConflictDoNothing();
    await db.insert(apCorporation).values({ id: CORP, name: 'User API Abuse Corp' });
    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    await db.insert(apCharacter).values({
      id: MAIN,
      userId,
      name: 'User API Abuser',
      ownerHash: 'user-api-abuse-hash',
      authzLevel: 'member',
      corporationId: CORP,
      allianceId: null,
      status: 'active',
    });
    await db.update(apUser).set({ mainCharacterId: MAIN }).where(eq(apUser.id, userId));
    const [m] = await db
      .insert(apMap)
      .values({
        name: MAP_NAME,
        scope: 'wh',
        type: 'corp',
        ownerCorporationId: CORP,
        apiEnabled: true,
        apiScopes: ['map'],
      })
      .returning({ id: apMap.id });
    mapId = m!.id;
  });

  beforeEach(async () => {
    clearUserApiAuthCache();
    await db.delete(apMapEvent).where(eq(apMapEvent.mapId, mapId));
    await db.delete(apMapApiToken).where(eq(apMapApiToken.mapId, mapId));
    await db
      .update(apUser)
      .set({ apiBlockedAt: null, apiBlockedUntil: null, apiBlockReason: null })
      .where(eq(apUser.id, userId));
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

  it('walks a token through suspension, longer suspension, revocation and account block', async () => {
    const victim = await mintToken('hammer');
    const bystander = await mintToken('quiet tool');
    const t0 = Date.now();
    expect((await authorizeUserApiBearer(victim.header, t0)).ok).toBe(true);
    expect((await authorizeUserApiBearer(bystander.header, t0)).ok).toBe(true);

    const s1 = await applyUserApiStrike(victim.id, new Date(t0));
    expect(s1).toMatchObject({ action: 'suspended', strike: 1, until: new Date(t0 + 15 * MIN) });
    expect(await tokenRow(victim.id)).toMatchObject({
      strikeCount: 1,
      lastStrikeAt: new Date(t0),
      suspendedUntil: new Date(t0 + 15 * MIN),
      revokedAt: null,
    });
    expect(await authorizeUserApiBearer(victim.header, t0 + 1)).toMatchObject({
      status: 403,
      code: 'token_suspended',
      retryAfterSec: 15 * 60,
    });
    expect(await events()).toEqual([
      {
        kind: 'api.token_suspended',
        characterId: null,
        payload: expect.objectContaining({
          tokenId: victim.id.toString(),
          label: 'hammer',
          until: new Date(t0 + 15 * MIN).toISOString(),
          strike: 1,
        }),
      },
    ]);

    // Each later step re-caches its tokens one ms before the strike, so the
    // check after it lands inside that entry's TTL and passes only through the
    // invalidation.
    const t1 = t0 + 5 * MIN;
    expect(await authorizeUserApiBearer(victim.header, t1 - 1)).toMatchObject({
      code: 'token_suspended',
    });
    const s2 = await applyUserApiStrike(victim.id, new Date(t1));
    expect(s2).toMatchObject({ action: 'suspended', strike: 2, until: new Date(t1 + 6 * 60 * MIN) });
    expect(await tokenRow(victim.id)).toMatchObject({
      strikeCount: 2,
      suspendedUntil: new Date(t1 + 6 * 60 * MIN),
    });
    expect(await authorizeUserApiBearer(victim.header, t1 + 1)).toMatchObject({
      code: 'token_suspended',
      retryAfterSec: 6 * 60 * 60,
    });
    expect((await events()).map((e) => e.kind)).toEqual([
      'api.token_suspended',
      'api.token_suspended',
    ]);

    const t2 = t1 + 5 * MIN;
    expect(await authorizeUserApiBearer(victim.header, t2 - 1)).toMatchObject({
      code: 'token_suspended',
    });
    expect((await authorizeUserApiBearer(bystander.header, t2 - 1)).ok).toBe(true);
    const s3 = await applyUserApiStrike(victim.id, new Date(t2));
    expect(s3).toMatchObject({
      action: 'revoked',
      strike: 3,
      accountBlocked: true,
      accountBlockedUntil: new Date(t2 + 7 * DAY),
    });
    expect(await tokenRow(victim.id)).toMatchObject({
      strikeCount: 3,
      revokedAt: new Date(t2),
      revokedReason: 'abuse',
      revokedByCharacterId: null,
    });
    expect(await accountRow()).toMatchObject({
      apiBlockedAt: new Date(t2),
      apiBlockedUntil: new Date(t2 + 7 * DAY),
    });
    expect((await accountRow()).apiBlockReason).toContain('hammer');
    const all = await events();
    expect(all.map((e) => e.kind)).toEqual([
      'api.token_suspended',
      'api.token_suspended',
      'api.token_revoked',
    ]);
    expect(all[2]!.payload).toMatchObject({
      tokenId: victim.id.toString(),
      label: 'hammer',
      reason: 'abuse',
    });
    for (const e of all) {
      expect(JSON.stringify(e.payload)).not.toContain(victim.prefix);
      expect(JSON.stringify(e.payload)).not.toContain('User API Abuser');
    }

    expect(await authorizeUserApiBearer(victim.header, t2 + 1)).toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
    expect(await authorizeUserApiBearer(bystander.header, t2 + 1)).toMatchObject({
      status: 403,
      code: 'account_blocked',
    });
  });

  it('blocks indefinitely when the previous block began inside the repeat window', async () => {
    const now = Date.now();
    await db
      .update(apUser)
      .set({
        apiBlockedAt: new Date(now - 30 * DAY),
        apiBlockedUntil: new Date(now - 23 * DAY),
        apiBlockReason: 'earlier',
      })
      .where(eq(apUser.id, userId));
    const token = await mintToken('repeat', { strikeCount: 2, lastStrikeAt: new Date(now - DAY) });

    const s3 = await applyUserApiStrike(token.id, new Date(now));
    expect(s3).toMatchObject({ action: 'revoked', accountBlocked: true, accountBlockedUntil: null });
    expect(await accountRow()).toMatchObject({ apiBlockedAt: new Date(now), apiBlockedUntil: null });
    expect(await events()).toHaveLength(1);
  });

  it('blocks for the first-offence span when the previous block is outside the repeat window', async () => {
    const now = Date.now();
    await db
      .update(apUser)
      .set({ apiBlockedAt: new Date(now - 200 * DAY), apiBlockedUntil: new Date(now - 193 * DAY) })
      .where(eq(apUser.id, userId));
    const token = await mintToken('second', { strikeCount: 2, lastStrikeAt: new Date(now - DAY) });

    await applyUserApiStrike(token.id, new Date(now));
    expect(await accountRow()).toMatchObject({ apiBlockedUntil: new Date(now + 7 * DAY) });
  });

  it('leaves a standing block alone when a strike 3 lands on a blocked account', async () => {
    const now = Date.now();
    const until = new Date(now + 3 * DAY);
    await db
      .update(apUser)
      .set({ apiBlockedAt: new Date(now - DAY), apiBlockedUntil: until, apiBlockReason: 'manual' })
      .where(eq(apUser.id, userId));
    const token = await mintToken('late', { strikeCount: 2, lastStrikeAt: new Date(now - DAY) });
    expect(await authorizeUserApiBearer(token.header, now - 1)).toMatchObject({
      code: 'account_blocked',
    });

    const s3 = await applyUserApiStrike(token.id, new Date(now));
    expect(s3).toMatchObject({ action: 'revoked', accountBlocked: false, accountBlockedUntil: null });
    expect(await tokenRow(token.id)).toMatchObject({ revokedReason: 'abuse' });
    // No account invalidation runs here, so only the token's own invalidation
    // turns the cached `account_blocked` into the revoke.
    expect(await authorizeUserApiBearer(token.header, now + 1)).toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
    expect(await accountRow()).toMatchObject({
      apiBlockedAt: new Date(now - DAY),
      apiBlockedUntil: until,
      apiBlockReason: 'manual',
    });
    expect(await events()).toHaveLength(1);
  });

  it('restarts from strike 1 once the previous strike has decayed', async () => {
    const now = Date.now();
    const token = await mintToken('decayed', { strikeCount: 2, lastStrikeAt: new Date(now - 8 * DAY) });
    expect(await applyUserApiStrike(token.id, new Date(now))).toMatchObject({
      action: 'suspended',
      strike: 1,
    });
    expect(await tokenRow(token.id)).toMatchObject({ strikeCount: 1, revokedAt: null });
  });

  it('writes nothing for a revoked or unknown token', async () => {
    const token = await mintToken('gone');
    await db
      .update(apMapApiToken)
      .set({ revokedAt: new Date(), revokedReason: 'creator' })
      .where(eq(apMapApiToken.id, token.id));
    expect(await applyUserApiStrike(token.id)).toBeNull();
    expect(await applyUserApiStrike(token.id + 1_000_000n)).toBeNull();
    expect(await tokenRow(token.id)).toMatchObject({ strikeCount: 0, suspendedUntil: null });
    expect(await events()).toHaveLength(0);
  });
});

async function mintToken(
  label: string,
  strikes: { strikeCount: number; lastStrikeAt: Date | null } = { strikeCount: 0, lastStrikeAt: null },
) {
  const { token, hash, prefix } = generateUserApiToken();
  const [t] = await db
    .insert(apMapApiToken)
    .values({ mapId, userId, tokenHash: hash, tokenPrefix: prefix, label, scopes: ['map'], ...strikes })
    .returning({ id: apMapApiToken.id });
  return { id: t!.id, header: `Bearer ${token}`, prefix };
}

async function tokenRow(id: bigint) {
  const [row] = await db.select().from(apMapApiToken).where(eq(apMapApiToken.id, id));
  return row!;
}

async function accountRow() {
  const [row] = await db.select().from(apUser).where(eq(apUser.id, userId));
  return row!;
}

async function events() {
  return db
    .select({ kind: apMapEvent.kind, characterId: apMapEvent.characterId, payload: apMapEvent.payload })
    .from(apMapEvent)
    .where(eq(apMapEvent.mapId, mapId))
    .orderBy(asc(apMapEvent.id));
}

async function cleanup() {
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  await db
    .delete(apInstanceOwner)
    .where(and(eq(apInstanceOwner.principalKind, 'corporation'), eq(apInstanceOwner.principalId, CORP)));
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(eq(apCharacter.id, MAIN));
  await db.delete(apCharacter).where(eq(apCharacter.id, MAIN));
  const userIds = [...new Set([...users.map((u) => u.userId), userId])].filter((id) => id !== 0);
  if (userIds.length > 0) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(apCorporation).where(eq(apCorporation.id, CORP));
}
