// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
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
  apUser,
} from '@/db/schema';
import { authorizeUserApiBearer, clearUserApiAuthCache } from '@/lib/userApi/authorize';
import {
  invalidateUserApiInstanceSwitch,
  isUserApiInstanceEnabled,
} from '@/lib/userApi/instance';
import { generateUserApiToken } from '@/lib/userApi/token';

/**
 * The operator's user API controls against real Postgres with `auth()`
 * mocked: the instance switch (`adminSetUserApiEnabled`) and the account
 * block and lift (`adminBlockUserApi` / `adminLiftUserApiBlock`), their
 * `isAdmin` gate, and the auth-cache invalidation each runs after its write.
 * `ap_instance` is a live singleton: its access mode and user API switch are
 * snapshotted and restored. The test corp owns the instance, so the target's
 * main passes the login gate. Ids use a 9739xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-admin-actions
 */
const run = process.env.RUN_DB_TESTS === '1';

let currentSession: Session | null = null;
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { adminBlockUserApi, adminLiftUserApiBlock } = await import(
  '@/app/(admin)/actions/members'
);
const { adminSetUserApiEnabled } = await import('@/app/(admin)/actions/settings');
const { listAdminMembers } = await import('@/lib/auth/members');

const CORP = 97399001n;
const ADMIN = 97390001n;
const DIRECTOR = 97390002n;
const MEMBER = 97390003n;
const TARGET_MAIN = 97390004n;
const TARGET_ALT = 97390005n;
const CHARACTERS = [ADMIN, DIRECTOR, MEMBER, TARGET_MAIN, TARGET_ALT];
const MAP_NAME = 'User API Admin Map';

const users = { admin: 0, director: 0, member: 0, target: 0 };
let mapId = 0n;
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

function actAs(characterId: bigint | null): void {
  currentSession =
    characterId === null
      ? null
      : ({ characterId: characterId.toString(), user: { id: '0' } } as unknown as Session);
}

async function readBlock() {
  const [row] = await db
    .select({
      at: apUser.apiBlockedAt,
      until: apUser.apiBlockedUntil,
      reason: apUser.apiBlockReason,
    })
    .from(apUser)
    .where(eq(apUser.id, users.target));
  return row!;
}

async function mintTargetToken(): Promise<string> {
  const { token, hash, prefix } = generateUserApiToken();
  await db.insert(apMapApiToken).values({
    mapId,
    userId: users.target,
    tokenHash: hash,
    tokenPrefix: prefix,
    label: 'operator test',
    scopes: ['map'],
  });
  return `Bearer ${token}`;
}

describe.skipIf(!run)('user API operator actions (real Postgres)', () => {
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
    await db.insert(apInstanceOwner).values({ principalKind: 'corporation', principalId: CORP });
    await db.insert(apCorporation).values({ id: CORP, name: 'User API Admin Corp' });

    for (const key of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
      users[key] = u!.id;
    }
    const char = (
      id: bigint,
      userId: number,
      name: string,
      extra: { authzLevel?: 'member' | 'admin'; isDirector?: boolean } = {},
    ) => ({
      id,
      userId,
      name,
      ownerHash: `user-api-admin-${id}`,
      authzLevel: extra.authzLevel ?? ('member' as const),
      isDirector: extra.isDirector ?? false,
      corporationId: CORP,
      allianceId: null,
      status: 'active' as const,
    });
    await db.insert(apCharacter).values([
      char(ADMIN, users.admin, 'Operator Admin', { authzLevel: 'admin' }),
      char(DIRECTOR, users.director, 'Operator Director', { isDirector: true }),
      char(MEMBER, users.member, 'Operator Member'),
      char(TARGET_MAIN, users.target, 'Operator Target Main'),
      char(TARGET_ALT, users.target, 'Operator Target Alt'),
    ]);
    await db
      .update(apUser)
      .set({ mainCharacterId: TARGET_MAIN })
      .where(eq(apUser.id, users.target));

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
    invalidateUserApiInstanceSwitch();
    await db.update(apInstance).set({ userApiEnabled: true }).where(eq(apInstance.id, 1));
    await db.delete(apMapApiToken).where(eq(apMapApiToken.mapId, mapId));
    await db
      .update(apUser)
      .set({ apiBlockedAt: null, apiBlockedUntil: null, apiBlockReason: null })
      .where(eq(apUser.id, users.target));
    actAs(ADMIN);
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

  it.each([
    ['a corp Director', DIRECTOR],
    ['a plain member', MEMBER],
    ['an unauthenticated session', null],
  ] as const)('refuses all three actions to %s', async (_who, characterId) => {
    actAs(characterId);
    expect((await adminSetUserApiEnabled({ enabled: false })).ok).toBe(false);
    expect((await adminBlockUserApi(TARGET_MAIN.toString(), 'No.')).ok).toBe(false);
    await db
      .update(apUser)
      .set({ apiBlockedAt: new Date(), apiBlockedUntil: null, apiBlockReason: 'Standing.' })
      .where(eq(apUser.id, users.target));
    expect((await adminLiftUserApiBlock(TARGET_MAIN.toString())).ok).toBe(false);

    const [instance] = await db
      .select({ enabled: apInstance.userApiEnabled })
      .from(apInstance)
      .where(eq(apInstance.id, 1));
    expect(instance!.enabled).toBe(true);
    expect(await readBlock()).toMatchObject({ until: null, reason: 'Standing.' });
  });

  it('turns the instance switch off and on, visible to the next cached read', async () => {
    expect(await isUserApiInstanceEnabled()).toBe(true);

    expect(await adminSetUserApiEnabled({ enabled: false })).toEqual({ ok: true });
    expect(await isUserApiInstanceEnabled()).toBe(false);

    expect(await adminSetUserApiEnabled({ enabled: true })).toEqual({ ok: true });
    expect(await isUserApiInstanceEnabled()).toBe(true);
  });

  it('blocks the whole account indefinitely with a required reason', async () => {
    expect(await adminBlockUserApi(TARGET_ALT.toString(), '   ')).toEqual({
      ok: false,
      error: 'Reason is required.',
    });
    expect((await readBlock()).at).toBeNull();

    expect(await adminBlockUserApi(TARGET_ALT.toString(), '  Reselling map intel.  ')).toEqual({
      ok: true,
    });
    const block = await readBlock();
    expect(block.at).not.toBeNull();
    expect(block.until).toBeNull();
    expect(block.reason).toBe('Reselling map intel.');

    const rows = await listAdminMembers();
    for (const id of [TARGET_MAIN, TARGET_ALT]) {
      expect(rows.find((r) => r.id === id.toString())!.apiBlock).toEqual({
        reason: 'Reselling map intel.',
        until: null,
      });
    }
    expect(rows.find((r) => r.id === MEMBER.toString())!.apiBlock).toBeNull();
  });

  it('refuses an unknown character', async () => {
    expect(await adminBlockUserApi('97390999', 'Reason.')).toEqual({
      ok: false,
      error: 'Character not found.',
    });
    expect(await adminLiftUserApiBlock('97390999')).toEqual({
      ok: false,
      error: 'Character not found.',
    });
  });

  it('lifts a timed block by ending it now and keeps api_blocked_at', async () => {
    const began = new Date(Date.now() - 86_400_000);
    await db
      .update(apUser)
      .set({
        apiBlockedAt: began,
        apiBlockedUntil: new Date(Date.now() + 6 * 86_400_000),
        apiBlockReason: 'Automatic block.',
      })
      .where(eq(apUser.id, users.target));

    expect(await adminLiftUserApiBlock(TARGET_MAIN.toString())).toEqual({ ok: true });
    const block = await readBlock();
    expect(block.at!.getTime()).toBe(began.getTime());
    expect(block.until).not.toBeNull();
    expect(block.until!.getTime()).toBeLessThanOrEqual(Date.now());

    const rows = await listAdminMembers();
    expect(rows.find((r) => r.id === TARGET_MAIN.toString())!.apiBlock).toBeNull();

    expect(await adminLiftUserApiBlock(TARGET_MAIN.toString())).toEqual({
      ok: false,
      error: 'This account has no API block.',
    });
  });

  it("drops the account's cached authorisations on block and on lift", async () => {
    const header = await mintTargetToken();
    expect((await authorizeUserApiBearer(header)).ok).toBe(true);

    // A write that bypasses the action leaves the cached allow in place, so
    // the next checks prove the action's invalidation, not the TTL.
    await db
      .update(apUser)
      .set({ apiBlockedAt: new Date(), apiBlockedUntil: null, apiBlockReason: 'Direct.' })
      .where(eq(apUser.id, users.target));
    expect((await authorizeUserApiBearer(header)).ok).toBe(true);
    await db
      .update(apUser)
      .set({ apiBlockedAt: null, apiBlockedUntil: null, apiBlockReason: null })
      .where(eq(apUser.id, users.target));

    expect(await adminBlockUserApi(TARGET_ALT.toString(), 'Blocked.')).toEqual({ ok: true });
    expect(await authorizeUserApiBearer(header)).toMatchObject({
      ok: false,
      status: 403,
      code: 'account_blocked',
    });

    // The refusal is cached now; a direct lift leaves it in place.
    await db
      .update(apUser)
      .set({ apiBlockedUntil: new Date(Date.now() - 1_000) })
      .where(eq(apUser.id, users.target));
    expect(await authorizeUserApiBearer(header)).toMatchObject({ code: 'account_blocked' });
    await db.update(apUser).set({ apiBlockedUntil: null }).where(eq(apUser.id, users.target));

    expect(await adminLiftUserApiBlock(TARGET_MAIN.toString())).toEqual({ ok: true });
    expect((await authorizeUserApiBearer(header)).ok).toBe(true);
  });
});

async function cleanup() {
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  await db
    .delete(apInstanceOwner)
    .where(
      and(eq(apInstanceOwner.principalKind, 'corporation'), eq(apInstanceOwner.principalId, CORP)),
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
  await db.delete(apCorporation).where(eq(apCorporation.id, CORP));
}
