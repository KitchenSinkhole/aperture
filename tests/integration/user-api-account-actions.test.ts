// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { authorizeUserApiBearer, clearUserApiAuthCache } from '@/lib/userApi/authorize';
import { invalidateUserApiInstanceSwitch } from '@/lib/userApi/instance';
import { generateUserApiToken } from '@/lib/userApi/token';
import type { ApiScope } from '@/types';

/**
 * The Account Settings API tokens section's actions (`getAccountApiTokens`,
 * and `revokeMapApiToken` from `src/app/(app)/actions/mapApi.ts`) and the
 * set-main action's auth-cache invalidation, against real Postgres with
 * `auth()` mocked. `ap_instance` is a live singleton: its access mode and user
 * API switch are snapshotted and restored. Both corps that hold characters own
 * the instance, so every character passes the login gate and `canViewMap` is
 * the only access cause. Ids use a 9738xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-account-actions
 */
const run = process.env.RUN_DB_TESTS === '1';

let currentSession: Session | null = null;
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { getAccountApiTokens, revokeMapApiToken } = await import('@/app/(app)/actions/mapApi');
const { setMainCharacterAction } = await import('@/app/(app)/actions/account');

const CORP = 97389001n;
const OTHER_CORP = 97389002n;
const FOREIGN_CORP = 97389003n;
const MAIN = 97380001n;
const ALT = 97380002n;
const STRANGER = 97380003n;
const CHARACTERS = [MAIN, ALT, STRANGER];
const MAP_NAMES = {
  home: 'User API Account Home',
  off: 'User API Account Off',
  foreign: 'User API Account Foreign',
  deleted: 'User API Account Deleted',
} as const;

const users = { owner: 0, stranger: 0 };
const maps = { home: 0n, off: 0n, foreign: 0n, deleted: 0n };
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

function actAs(characterId: bigint, userId: number): void {
  currentSession = {
    characterId: characterId.toString(),
    userId,
    user: { id: String(userId) },
  } as unknown as Session;
}

async function insertToken(
  userId: number,
  mapId: bigint,
  opts: {
    label?: string;
    scopes?: ApiScope[];
    expiresAt?: Date | null;
    revokedAt?: Date | null;
  } = {},
): Promise<{ id: bigint; token: string }> {
  const { token, hash, prefix } = generateUserApiToken();
  const [row] = await db
    .insert(apMapApiToken)
    .values({
      mapId,
      userId,
      tokenHash: hash,
      tokenPrefix: prefix,
      label: opts.label ?? 'seeded',
      scopes: opts.scopes ?? ['map'],
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revokedAt ?? null,
    })
    .returning({ id: apMapApiToken.id });
  return { id: row!.id, token };
}

describe.skipIf(!run)('account API token actions (real Postgres)', () => {
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
    await db.insert(apInstanceOwner).values([
      { principalKind: 'corporation', principalId: CORP },
      { principalKind: 'corporation', principalId: OTHER_CORP },
    ]);
    await db.insert(apCorporation).values([
      { id: CORP, name: 'User API Account Corp' },
      { id: OTHER_CORP, name: 'User API Account Elsewhere' },
      { id: FOREIGN_CORP, name: 'User API Account Foreign' },
    ]);

    for (const key of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
      users[key] = u!.id;
    }
    const char = (id: bigint, userId: number, name: string, corp: bigint) => ({
      id,
      userId,
      name,
      ownerHash: `user-api-account-${id}`,
      authzLevel: 'member' as const,
      corporationId: corp,
      allianceId: null,
      isDirector: false,
      status: 'active' as const,
    });
    await db
      .insert(apCharacter)
      .values([
        char(MAIN, users.owner, 'Account Main', CORP),
        char(ALT, users.owner, 'Account Alt', OTHER_CORP),
        char(STRANGER, users.stranger, 'Account Stranger', CORP),
      ]);
    await db.update(apUser).set({ mainCharacterId: STRANGER }).where(eq(apUser.id, users.stranger));

    const rows = await db
      .insert(apMap)
      .values([
        { name: MAP_NAMES.home, scope: 'wh', type: 'corp', ownerCorporationId: CORP },
        { name: MAP_NAMES.off, scope: 'wh', type: 'corp', ownerCorporationId: CORP },
        { name: MAP_NAMES.foreign, scope: 'wh', type: 'corp', ownerCorporationId: FOREIGN_CORP },
        { name: MAP_NAMES.deleted, scope: 'wh', type: 'corp', ownerCorporationId: CORP },
      ])
      .returning({ id: apMap.id, name: apMap.name });
    for (const key of Object.keys(maps) as (keyof typeof maps)[]) {
      maps[key] = rows.find((r) => r.name === MAP_NAMES[key])!.id;
    }
  });

  beforeEach(async () => {
    clearUserApiAuthCache();
    invalidateUserApiInstanceSwitch();
    const mapIds = Object.values(maps);
    await db.delete(apMapEvent).where(inArray(apMapEvent.mapId, mapIds));
    await db.delete(apMapApiToken).where(inArray(apMapApiToken.mapId, mapIds));
    await db
      .update(apMap)
      .set({ apiEnabled: true, apiScopes: ['map'], deletedAt: null })
      .where(inArray(apMap.id, mapIds));
    await db.update(apMap).set({ apiEnabled: false }).where(eq(apMap.id, maps.off));
    await db.update(apMap).set({ deletedAt: new Date() }).where(eq(apMap.id, maps.deleted));
    await db
      .update(apUser)
      .set({
        mainCharacterId: MAIN,
        apiBlockedAt: null,
        apiBlockedUntil: null,
        apiBlockReason: null,
      })
      .where(eq(apUser.id, users.owner));
    actAs(MAIN, users.owner);
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

  it('lists every non-revoked token the account owns, on any map, with its computed status', async () => {
    const active = await insertToken(users.owner, maps.home, { label: 'active' });
    const expired = await insertToken(users.owner, maps.home, {
      label: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const off = await insertToken(users.owner, maps.off, { label: 'off' });
    const foreign = await insertToken(users.owner, maps.foreign, { label: 'foreign' });
    const deleted = await insertToken(users.owner, maps.deleted, { label: 'deleted' });
    await insertToken(users.owner, maps.home, { label: 'revoked', revokedAt: new Date() });
    await insertToken(users.stranger, maps.home, { label: 'not mine' });

    const result = await getAccountApiTokens();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.instanceEnabled).toBe(true);
    expect(result.data.block).toBeNull();
    const byId = new Map(result.data.tokens.map((t) => [t.id, t]));
    expect([...byId.keys()].sort()).toEqual(
      [active, expired, off, foreign, deleted].map((t) => t.id.toString()).sort(),
    );
    expect(byId.get(active.id.toString())).toMatchObject({
      status: 'active',
      mapId: maps.home.toString(),
      mapName: MAP_NAMES.home,
      ownerName: 'Account Main',
      own: true,
    });
    expect(byId.get(expired.id.toString())!.status).toBe('expired');
    expect(byId.get(off.id.toString())).toMatchObject({
      status: 'api_disabled',
      mapName: MAP_NAMES.off,
    });
    expect(byId.get(foreign.id.toString())).toMatchObject({
      status: 'lost_access',
      mapName: MAP_NAMES.foreign,
    });
    expect(byId.get(deleted.id.toString())).toMatchObject({
      status: 'map_deleted',
      mapName: MAP_NAMES.deleted,
    });
    const serialised = JSON.stringify(result.data);
    expect(serialised).not.toContain(active.token);
  });

  it('revokes tokens on a map the account cannot view, a map with the API off and a deleted map, as creator', async () => {
    const targets = [
      { mapId: maps.foreign, ...(await insertToken(users.owner, maps.foreign, { label: 'f' })) },
      { mapId: maps.off, ...(await insertToken(users.owner, maps.off, { label: 'o' })) },
      { mapId: maps.deleted, ...(await insertToken(users.owner, maps.deleted, { label: 'd' })) },
    ];
    actAs(ALT, users.owner);

    for (const target of targets) {
      expect(await revokeMapApiToken(target.id.toString())).toEqual({ ok: true });
      const [row] = await db
        .select({
          revokedAt: apMapApiToken.revokedAt,
          revokedReason: apMapApiToken.revokedReason,
          revokedByCharacterId: apMapApiToken.revokedByCharacterId,
        })
        .from(apMapApiToken)
        .where(eq(apMapApiToken.id, target.id));
      expect(row!.revokedAt).not.toBeNull();
      expect(row!.revokedReason).toBe('creator');
      expect(row!.revokedByCharacterId).toBe(ALT);

      const log = await db
        .select({
          kind: apMapEvent.kind,
          characterId: apMapEvent.characterId,
          payload: apMapEvent.payload,
        })
        .from(apMapEvent)
        .where(eq(apMapEvent.mapId, target.mapId))
        .orderBy(asc(apMapEvent.id));
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        kind: 'api.token_revoked',
        characterId: ALT,
        payload: {
          tokenId: target.id.toString(),
          reason: 'creator',
          ownerCharacterId: Number(MAIN),
          ownerName: 'Account Main',
        },
      });
    }

    const listed = await getAccountApiTokens();
    expect(listed.ok && listed.data.tokens).toEqual([]);
  });

  it("drops the account's cached authorisations when the main changes", async () => {
    const { token } = await insertToken(users.owner, maps.home);
    const header = `Bearer ${token}`;
    expect((await authorizeUserApiBearer(header)).ok).toBe(true);

    // A write that bypasses the action leaves the cached allow in place,
    // so the next check below proves the action's invalidation, not the TTL.
    await db.update(apUser).set({ mainCharacterId: ALT }).where(eq(apUser.id, users.owner));
    expect((await authorizeUserApiBearer(header)).ok).toBe(true);

    expect(await setMainCharacterAction(ALT.toString())).toEqual({ ok: true });
    const after = await authorizeUserApiBearer(header);
    expect(after).toMatchObject({ ok: false, status: 403, code: 'access_lost' });
  });

  it("reports the account's block, timed or indefinite", async () => {
    const until = new Date(Date.now() + 7 * 86_400_000);
    await db
      .update(apUser)
      .set({ apiBlockedAt: new Date(), apiBlockedUntil: until, apiBlockReason: 'Strike three.' })
      .where(eq(apUser.id, users.owner));
    const timed = await getAccountApiTokens();
    expect(timed.ok && timed.data.block).toEqual({
      reason: 'Strike three.',
      until: until.toISOString(),
    });

    await db
      .update(apUser)
      .set({ apiBlockedUntil: null, apiBlockReason: 'Repeat offence.' })
      .where(eq(apUser.id, users.owner));
    const indefinite = await getAccountApiTokens();
    expect(indefinite.ok && indefinite.data.block).toEqual({
      reason: 'Repeat offence.',
      until: null,
    });
  });
});

async function cleanup() {
  await db.delete(apMap).where(inArray(apMap.name, Object.values(MAP_NAMES)));
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
  await db.delete(apCorporation).where(inArray(apCorporation.id, [CORP, OTHER_CORP, FOREIGN_CORP]));
}
