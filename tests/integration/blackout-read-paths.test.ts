// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { db, pool } from '@/db/client';
import {
  apAccessGrant,
  apCharacter,
  apInstance,
  apMap,
  apMapCharacterTracking,
  apMapConnection,
  apMapConnectionLog,
  apMapShare,
  apMapSystem,
  apUser,
  universeConstellation,
  universeRegion,
  universeSystem,
} from '@/db/schema';
import { addMapViewer, removeMapViewer } from '@/lib/realtime/mapViewers';

/**
 * Blackout on the read paths (real Postgres): the map page's initial roster,
 * the public share payload and its snapshot cache, the viewers route and the
 * mass-log route all apply the same rule as the socket.
 *
 * `ap_instance` is a live singleton, so the switch is snapshotted in `beforeAll`
 * and restored in `afterAll`. Ids use a 9724xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test blackout-read-paths
 */
const run = process.env.RUN_DB_TESTS === '1';

let currentSession: Session | null = null;
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => currentSession) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { loadMapForView } = await import('@/lib/map/loadMap');
const { loadPublicMapView } = await import('@/lib/map/loadPublicMap');
const { getPublicSnapshot, __resetPublicSnapshotState } = await import('@/lib/map/publicSnapshot');
const { adminStartBlackout, adminEndBlackout } = await import('@/app/(admin)/actions/blackout');
const { GET: viewersRoute } = await import('@/app/api/map/[mapId]/viewers/route');
const { GET: massLogRoute } = await import(
  '@/app/api/map/[mapId]/connections/[connId]/mass-log/route'
);

const REGION = 97240001;
const CONSTELLATION = 97240001;
const SYS_A = 97240001;
const SYS_B = 97240002;

const CORP = 97249001n;

const MEMBER_CHAR = 97240001n; // not cleared
const MEMBER_ALT = 97240002n; // same account as MEMBER_CHAR
const CLEARED_CHAR = 97240003n; // by-name blackout_view grant
const OTHER_CHAR = 97240004n; // an unrelated account
const ADMIN_CHAR = 97240005n; // flips the switch; never tracked
const characterIds = [MEMBER_CHAR, MEMBER_ALT, CLEARED_CHAR, OTHER_CHAR, ADMIN_CHAR];
const trackedIds = [MEMBER_CHAR, MEMBER_ALT, CLEARED_CHAR, OTHER_CHAR];

const SHARE_TOKEN = 'read-paths-full';

const accounts = { member: 0, cleared: 0, other: 0, admin: 0 };
let mapId = 0n;
let connectionId = 0n;
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

function asSession(characterId: bigint, userId: number): Session {
  return { characterId: characterId.toString(), userId, user: { id: '0' } } as unknown as Session;
}

async function setSwitch(on: boolean): Promise<void> {
  await db
    .update(apInstance)
    .set({ blackoutSince: on ? new Date() : null, blackoutByCharacterId: null })
    .where(eq(apInstance.id, 1));
}

function rosterIds(data: { presence: { characterId: number }[] } | null): number[] {
  return (data?.presence ?? []).map((p) => p.characterId).sort();
}

const ids = (list: bigint[]) => list.map(Number).sort();

async function callViewers(): Promise<number[]> {
  const res = await viewersRoute(
    new NextRequest(`http://localhost/api/map/${mapId}/viewers`),
    { params: Promise.resolve({ mapId: mapId.toString() }) },
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { characterIds: number[] };
  return [...json.characterIds].sort();
}

async function callMassLog(): Promise<{ ok: boolean; data: unknown[]; hidden?: boolean }> {
  const res = await massLogRoute(
    new NextRequest(`http://localhost/api/map/${mapId}/connections/${connectionId}/mass-log`),
    { params: Promise.resolve({ mapId: mapId.toString(), connId: connectionId.toString() }) },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { ok: boolean; data: unknown[]; hidden?: boolean };
}

describe.skipIf(!run)('Blackout read paths (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Read Paths Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Read Paths Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'BRP A', security: 'C3' },
      { id: SYS_B, constellationId: CONSTELLATION, name: 'BRP B', security: 'C3' },
    ]);

    for (const key of Object.keys(accounts) as Array<keyof typeof accounts>) {
      const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
      accounts[key] = u!.id;
    }
    await db.insert(apCharacter).values([
      mkChar(MEMBER_CHAR, accounts.member, SYS_A),
      mkChar(MEMBER_ALT, accounts.member, SYS_B),
      mkChar(CLEARED_CHAR, accounts.cleared, SYS_A),
      mkChar(OTHER_CHAR, accounts.other, SYS_B),
      { ...mkChar(ADMIN_CHAR, accounts.admin, SYS_A), authzLevel: 'admin' as const, lastOnline: false },
    ]);
    await db.insert(apAccessGrant).values({
      principalKind: 'character',
      principalId: CLEARED_CHAR,
      scope: 'instance',
      mapId: null,
      capability: 'blackout_view',
    });

    const [m] = await db
      .insert(apMap)
      .values({ name: 'Read Paths Map', scope: 'wh', type: 'corp', ownerCorporationId: CORP })
      .returning({ id: apMap.id });
    mapId = m!.id;
    await db
      .insert(apMapCharacterTracking)
      .values(trackedIds.map((characterId) => ({ mapId, characterId })));

    const systems = await db
      .insert(apMapSystem)
      .values([
        { mapId, systemId: SYS_A, visible: true, positionX: 0, positionY: 0 },
        { mapId, systemId: SYS_B, visible: true, positionX: 100, positionY: 0 },
      ])
      .returning({ id: apMapSystem.id, systemId: apMapSystem.systemId });
    const [conn] = await db
      .insert(apMapConnection)
      .values({
        mapId,
        sourceMapSystemId: systems.find((s) => s.systemId === SYS_A)!.id,
        targetMapSystemId: systems.find((s) => s.systemId === SYS_B)!.id,
        scope: 'wh',
        massStatus: 'fresh',
        confirmedAt: new Date(),
      })
      .returning({ id: apMapConnection.id });
    connectionId = conn!.id;
    await db
      .insert(apMapConnectionLog)
      .values({ connectionId, characterId: OTHER_CHAR, mass: 10_000_000n });

    await db.insert(apMapShare).values({
      mapId,
      token: SHARE_TOKEN,
      label: 'Full presence',
      presenceMode: 'full',
    });

    addMapViewer(mapId, accounts.member);
    addMapViewer(mapId, accounts.cleared);
    addMapViewer(mapId, accounts.other);
  });

  afterAll(async () => {
    removeMapViewer(mapId, accounts.member);
    removeMapViewer(mapId, accounts.cleared);
    removeMapViewer(mapId, accounts.other);
    await cleanup();
    if (instanceSnapshot) {
      await db
        .update(apInstance)
        .set({
          blackoutSince: instanceSnapshot.blackoutSince,
          blackoutByCharacterId: instanceSnapshot.blackoutByCharacterId,
        })
        .where(eq(apInstance.id, 1));
    }
    await pool.end();
  });

  beforeEach(async () => {
    currentSession = null;
    __resetPublicSnapshotState();
    await setSwitch(false);
  });

  describe('initial roster (loadMapForView)', () => {
    it('while off, every viewer sees every pilot and an inactive standing', async () => {
      const member = await loadMapForView(mapId, MEMBER_CHAR, accounts.member);
      expect(rosterIds(member)).toEqual(ids(trackedIds));
      expect(member!.blackout).toEqual({ active: false, since: null, cleared: false });

      const cleared = await loadMapForView(mapId, CLEARED_CHAR, accounts.cleared);
      expect(rosterIds(cleared)).toEqual(ids(trackedIds));
      expect(cleared!.blackout).toEqual({ active: false, since: null, cleared: true });
    });

    it("while on, a non-cleared viewer sees only their own account's pilots", async () => {
      await setSwitch(true);
      const member = await loadMapForView(mapId, MEMBER_CHAR, accounts.member);
      expect(rosterIds(member)).toEqual(ids([MEMBER_CHAR, MEMBER_ALT]));
      expect(member!.blackout.active).toBe(true);
      expect(member!.blackout.cleared).toBe(false);
      expect(typeof member!.blackout.since).toBe('string');
    });

    it('while on, a cleared viewer sees every pilot', async () => {
      await setSwitch(true);
      const cleared = await loadMapForView(mapId, CLEARED_CHAR, accounts.cleared);
      expect(rosterIds(cleared)).toEqual(ids(trackedIds));
      expect(cleared!.blackout).toMatchObject({ active: true, cleared: true });
    });
  });

  describe('public share', () => {
    it('carries full presence while off', async () => {
      const data = await loadPublicMapView(SHARE_TOKEN);
      expect(data!.presence.mode).toBe('full');
      if (data!.presence.mode !== 'full') return;
      expect(data!.presence.pilots.map((p) => p.characterId).sort()).toEqual(ids(trackedIds));
    });

    it('carries presence none while on, and nothing that mentions Blackout', async () => {
      await setSwitch(true);
      const data = await loadPublicMapView(SHARE_TOKEN);
      expect(data!.presence).toEqual({ mode: 'none' });
      expect(JSON.stringify(data).toLowerCase()).not.toContain('blackout');
    });

    it('does not serve a snapshot cached before a flip', async () => {
      currentSession = asSession(ADMIN_CHAR, accounts.admin);

      const before = await getPublicSnapshot(SHARE_TOKEN);
      expect(before!.presence.mode).toBe('full');

      expect(await adminStartBlackout()).toEqual({ ok: true });
      const during = await getPublicSnapshot(SHARE_TOKEN);
      expect(during!.presence).toEqual({ mode: 'none' });

      expect(await adminEndBlackout()).toEqual({ ok: true });
      const after = await getPublicSnapshot(SHARE_TOKEN);
      expect(after!.presence.mode).toBe('full');
    });
  });

  describe('viewers route', () => {
    it('lists every viewing account while off', async () => {
      currentSession = asSession(MEMBER_CHAR, accounts.member);
      expect(await callViewers()).toEqual(ids(trackedIds));
    });

    it("returns only the viewer's own characters to a non-cleared viewer while on", async () => {
      await setSwitch(true);
      currentSession = asSession(MEMBER_CHAR, accounts.member);
      expect(await callViewers()).toEqual(ids([MEMBER_CHAR, MEMBER_ALT]));
    });

    it('lists every viewing account to a cleared viewer while on', async () => {
      await setSwitch(true);
      currentSession = asSession(CLEARED_CHAR, accounts.cleared);
      expect(await callViewers()).toEqual(ids(trackedIds));
    });
  });

  describe('mass-log route', () => {
    it('returns the hidden marker and no entries to a non-cleared viewer while on', async () => {
      await setSwitch(true);
      currentSession = asSession(MEMBER_CHAR, accounts.member);
      expect(await callMassLog()).toEqual({ ok: true, data: [], hidden: true });
    });

    it('returns the full log to a cleared viewer while on', async () => {
      await setSwitch(true);
      currentSession = asSession(CLEARED_CHAR, accounts.cleared);
      const body = await callMassLog();
      expect(body.data).toHaveLength(1);
      expect(body.hidden).toBeUndefined();
    });

    it('returns the full log to everyone once off', async () => {
      currentSession = asSession(MEMBER_CHAR, accounts.member);
      const body = await callMassLog();
      expect(body.data).toHaveLength(1);
      expect(body.hidden).toBeUndefined();
    });
  });
});

function mkChar(id: bigint, userId: number, systemId: number) {
  return {
    id,
    userId,
    name: `Read Paths ${id.toString()}`,
    ownerHash: `read-paths-hash-${id.toString()}`,
    authzLevel: 'member' as const,
    status: 'active' as const,
    corporationId: CORP,
    allianceId: null,
    lastSystemId: systemId,
    lastOnline: true,
    lastLocationAt: new Date(),
  };
}

async function cleanup() {
  await db.delete(apMap).where(eq(apMap.name, 'Read Paths Map'));
  await db
    .delete(apAccessGrant)
    .where(
      and(eq(apAccessGrant.principalKind, 'character'), inArray(apAccessGrant.principalId, characterIds)),
    );
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, characterIds));
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  const userIds = [...new Set([...users.map((u) => u.userId), ...Object.values(accounts)])].filter(
    (id) => id !== 0,
  );
  if (userIds.length) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYS_A, SYS_B]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
