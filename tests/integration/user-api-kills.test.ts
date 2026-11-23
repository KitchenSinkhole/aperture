// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apCorporation,
  apInstance,
  apInstanceOwner,
  apMap,
  apMapApiToken,
  apMapSystem,
  apUser,
  universeCategory,
  universeConstellation,
  universeGroup,
  universeKillmail,
  universeRegion,
  universeSystem,
  universeType,
} from '@/db/schema';
import type { NewUniverseKillmail, UserApiKill } from '@/types';
import { apertureConfig } from '../../aperture.config';

/**
 * `GET /api/v1/kills` end to end against real Postgres: only cached kills in
 * the token map's visible systems, newest first, `since` and `limit` with
 * their defaults and bounds, and no upstream call on the request path (the
 * zKillboard and ESI clients, and `fetch` itself, throw if touched).
 *
 * The clock is pinned with a Date-only fake timer to the start of a rate
 * window, as in `user-api.test.ts`. `ap_instance` is a live singleton: its
 * access mode and user API switch are snapshotted and restored. Ids use a
 * 9736xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-kills
 */
const run = process.env.RUN_DB_TESTS === '1';

const { recentKillsForSystem, esiCall } = vi.hoisted(() => ({
  recentKillsForSystem: vi.fn(async () => {
    throw new Error('zKillboard must not be called on the user API request path');
  }),
  esiCall: vi.fn(async () => {
    throw new Error('ESI must not be called on the user API request path');
  }),
}));
vi.mock('@/lib/integrations/zkb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/zkb')>()),
  recentKillsForSystem,
}));
vi.mock('@/lib/esi/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/esi/client')>()),
  esiCall,
}));

const { GET: killsGET } = await import('@/app/api/v1/kills/route');
const { clearUserApiAuthCache } = await import('@/lib/userApi/authorize');
const { clearUserApiProjections } = await import('@/lib/userApi/cache');
const { invalidateUserApiInstanceSwitch } = await import('@/lib/userApi/instance');
const { __resetUserApiRateLimit } = await import('@/lib/userApi/rateLimit');
const { generateUserApiToken } = await import('@/lib/userApi/token');
const { __resetUserApiUsage } = await import('@/lib/userApi/usage');

const CORP = 97369001n;
const MAIN = 97360001n;
const MAP_NAME = 'User API Kills Map';

const REGION = 97360001;
const CONSTELLATION = 97360001;
const SYS_A = 97360001;
const SYS_B = 97360002;
const SYS_HIDDEN = 97360003;
const SYS_OFF_MAP = 97360004;
const systemIds = [SYS_A, SYS_B, SYS_HIDDEN, SYS_OFF_MAP];

const CATEGORY = 97360001;
const GROUP = 97360001;
const SHIP = 97360001;
const SHIP_NAME = 'Kills Test Hull';

const KILL_BASE = 97360000000;
const BULK_BASE = 97361000000;

const W = apertureConfig.USER_API_RATE_WINDOW_MS;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX = apertureConfig.USER_API_KILLS_MAX_LIMIT;

let userId = 0;
let mapId = 0n;
let token = '';
let clock = 0;
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;
const originalFetch = globalThis.fetch;

/** The seeded kills by label, as offsets back from the pinned clock. */
const KILLS = {
  a1: { id: KILL_BASE + 1, system: SYS_A, ago: 1 * HOUR },
  b1: { id: KILL_BASE + 2, system: SYS_B, ago: 3 * HOUR },
  a2: { id: KILL_BASE + 3, system: SYS_A, ago: 30 * HOUR },
  b2: { id: KILL_BASE + 4, system: SYS_B, ago: 3 * DAY },
  a3: { id: KILL_BASE + 5, system: SYS_A, ago: 8 * DAY },
  hidden: { id: KILL_BASE + 6, system: SYS_HIDDEN, ago: 1 * HOUR },
  offMap: { id: KILL_BASE + 7, system: SYS_OFF_MAP, ago: 1 * HOUR },
} as const;
type Label = keyof typeof KILLS;

function killRow(id: number, system: number, at: number): NewUniverseKillmail {
  return {
    id: BigInt(id),
    hash: `kills-test-${id}`,
    killmailTime: new Date(at),
    totalValue: 1_000_000 + (id % 1000),
    body: {
      killmail_id: id,
      killmail_time: new Date(at).toISOString(),
      solar_system_id: system,
      victim: { ship_type_id: SHIP, character_id: 90000001, corporation_id: 98000001, alliance_id: 99000001 },
      attackers: [{}, {}, {}],
    },
  };
}

async function kills(query = ''): Promise<UserApiKill[]> {
  const res = await killsGET(
    new NextRequest(`http://localhost/api/v1/kills${query}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({}) },
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true });
  return body.data;
}

const labels = (list: UserApiKill[]): string[] =>
  list.map((k) => {
    const hit = (Object.keys(KILLS) as Label[]).find((l) => String(KILLS[l].id) === k.killmailId);
    return hit ?? k.killmailId;
  });

function resetInProcessState(): void {
  __resetUserApiRateLimit();
  __resetUserApiUsage();
  clearUserApiProjections();
  clearUserApiAuthCache();
  invalidateUserApiInstanceSwitch();
}

describe.skipIf(!run)('User API kills endpoint (real Postgres)', () => {
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
    await db.insert(apCorporation).values({ id: CORP, name: 'User API Kills Corp' });
    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    await db.insert(apCharacter).values({
      id: MAIN,
      userId,
      name: 'User API Kills Main',
      ownerHash: 'user-api-kills-hash',
      authzLevel: 'member',
      corporationId: CORP,
      allianceId: null,
      status: 'active',
    });
    await db.update(apUser).set({ mainCharacterId: MAIN }).where(eq(apUser.id, userId));

    await db.insert(universeRegion).values({ id: REGION, name: 'Kills Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Kills Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'UAK A', security: 'C3' },
      { id: SYS_B, constellationId: CONSTELLATION, name: 'UAK B', security: 'C3' },
      { id: SYS_HIDDEN, constellationId: CONSTELLATION, name: 'UAK Hidden', security: 'C3' },
      { id: SYS_OFF_MAP, constellationId: CONSTELLATION, name: 'UAK Off', security: 'C3' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Kills Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'Kills Grp' });
    await db.insert(universeType).values({ id: SHIP, groupId: GROUP, name: SHIP_NAME });

    const [m] = await db
      .insert(apMap)
      .values({
        name: MAP_NAME,
        scope: 'wh',
        type: 'corp',
        ownerCorporationId: CORP,
        apiEnabled: true,
        apiScopes: ['kills'],
      })
      .returning({ id: apMap.id });
    mapId = m!.id;
    await db.insert(apMapSystem).values([
      { mapId, systemId: SYS_A, visible: true, positionX: 0, positionY: 0 },
      { mapId, systemId: SYS_B, visible: true, positionX: 100, positionY: 0 },
      { mapId, systemId: SYS_HIDDEN, visible: false, positionX: 200, positionY: 0 },
    ]);

    const minted = generateUserApiToken();
    await db.insert(apMapApiToken).values({
      mapId,
      userId,
      tokenHash: minted.hash,
      tokenPrefix: minted.prefix,
      label: 'kills tool',
      scopes: ['kills'],
    });
    token = minted.token;
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    clock = Math.ceil(Date.now() / W) * W + 1_000;
    vi.setSystemTime(clock);
    resetInProcessState();
    globalThis.fetch = vi.fn(async () => {
      throw new Error('no outbound HTTP on the user API request path');
    }) as unknown as typeof fetch;

    await deleteKills();
    await db
      .insert(universeKillmail)
      .values(Object.values(KILLS).map((k) => killRow(k.id, k.system, clock - k.ago)));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetInProcessState();
    vi.useRealTimers();
  });

  afterAll(async () => {
    resetInProcessState();
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

  it('serves the last 24 hours of kills in visible systems, newest first, by default', async () => {
    const data = await kills();
    expect(labels(data)).toEqual(['a1', 'b1']);
    expect(data[0]).toEqual({
      killmailId: String(KILLS.a1.id),
      killmailTime: new Date(clock - KILLS.a1.ago).toISOString(),
      mapSystemId: expect.any(String),
      systemId: SYS_A,
      systemName: 'UAK A',
      shipTypeId: SHIP,
      shipTypeName: SHIP_NAME,
      victimCharacterId: '90000001',
      victimCorporationId: '98000001',
      victimAllianceId: '99000001',
      attackerCount: 3,
      totalValue: 1_000_000 + (KILLS.a1.id % 1000),
    });
  });

  it('honours since', async () => {
    const since = new Date(clock - 4 * DAY).toISOString();
    expect(labels(await kills(`?since=${encodeURIComponent(since)}`))).toEqual(['a1', 'b1', 'a2', 'b2']);
    const recent = new Date(clock - 2 * HOUR).toISOString();
    expect(labels(await kills(`?since=${encodeURIComponent(recent)}`))).toEqual(['a1']);
  });

  it('floors since at seven days back', async () => {
    const since = new Date(clock - 30 * DAY).toISOString();
    expect(labels(await kills(`?since=${encodeURIComponent(since)}`))).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('reads an unparseable since as the 24-hour default', async () => {
    expect(labels(await kills('?since=yesterday-ish'))).toEqual(['a1', 'b1']);
  });

  it('honours limit and clamps it into range', async () => {
    const since = `since=${encodeURIComponent(new Date(clock - 4 * DAY).toISOString())}`;
    expect(labels(await kills(`?${since}&limit=2`))).toEqual(['a1', 'b1']);
    expect(labels(await kills(`?${since}&limit=0`))).toEqual(['a1']);
    expect(labels(await kills(`?${since}&limit=-5`))).toEqual(['a1']);
    expect(labels(await kills(`?${since}&limit=lots`))).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it(`caps limit at ${MAX}`, async () => {
    await db
      .insert(universeKillmail)
      .values(Array.from({ length: MAX + 5 }, (_, i) => killRow(BULK_BASE + i, SYS_B, clock - 5 * HOUR - i * 1_000)));
    expect(await kills('?limit=100000')).toHaveLength(MAX);
    expect(await kills()).toHaveLength(MAX);
  });

  it('never calls zKillboard, ESI or the network', async () => {
    await kills();
    await kills('?since=2000-01-01T00:00:00Z&limit=5');
    expect(recentKillsForSystem).not.toHaveBeenCalled();
    expect(esiCall).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

async function deleteKills() {
  await db
    .delete(universeKillmail)
    .where(
      and(
        gte(universeKillmail.id, BigInt(KILL_BASE)),
        lte(universeKillmail.id, BigInt(BULK_BASE + 10_000)),
      ),
    );
}

async function cleanup() {
  await deleteKills();
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  await db
    .delete(apInstanceOwner)
    .where(and(eq(apInstanceOwner.principalKind, 'corporation'), eq(apInstanceOwner.principalId, CORP)));
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(eq(apCharacter.id, MAIN));
  const userIds = [...new Set([...users.map((u) => u.userId), userId])].filter((id) => id !== 0);
  if (userIds.length > 0) await db.update(apUser).set({ mainCharacterId: null }).where(inArray(apUser.id, userIds));
  await db.delete(apCharacter).where(eq(apCharacter.id, MAIN));
  if (userIds.length > 0) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(apCorporation).where(eq(apCorporation.id, CORP));
  await db.delete(universeType).where(eq(universeType.id, SHIP));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db.delete(universeSystem).where(inArray(universeSystem.id, systemIds));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
