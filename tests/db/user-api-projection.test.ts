// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
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
  apMapNote,
  apMapSignature,
  apMapSystem,
  apUser,
  universeConstellation,
  universeRegion,
  universeSystem,
} from '@/db/schema';
import type { BlackoutViewer, UserApiResource } from '@/types';

/**
 * User API read projections against real Postgres: each resource applies the
 * same visibility predicates as `loadMapForView`, carries no account linkage,
 * keeps intel notes out of `map`, follows the owner's Blackout standing, and
 * the Blackout switch empties both user API caches.
 *
 * `ap_instance` is a live singleton, so the Blackout switch is snapshotted and
 * restored. Ids use a 9733xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-projection
 */
const run = process.env.RUN_DB_TESTS === '1';

let currentSession: Session | null = null;
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { loadMapForView } = await import('@/lib/map/loadMap');
const { loadUserApiProjection } = await import('@/lib/userApi/projection');
const { getUserApiProjection, clearUserApiProjections, __userApiProjectionCacheSize } =
  await import('@/lib/userApi/cache');
const { resolveUserApiToken, clearUserApiAuthCache } = await import('@/lib/userApi/authorize');
const { getBlackoutStatus } = await import('@/lib/auth/blackout');
const { adminStartBlackout, adminEndBlackout } = await import('@/app/(admin)/actions/blackout');

const REGION = 97330001;
const CONSTELLATION = 97330001;
const SYS_A = 97330001;
const SYS_B = 97330002;
const SYS_HIDDEN = 97330003;
const systemIds = [SYS_A, SYS_B, SYS_HIDDEN];

const CORP = 97339001n;

const MEMBER_CHAR = 97330001n; // not cleared
const MEMBER_ALT = 97330002n; // same account as MEMBER_CHAR
const CLEARED_CHAR = 97330003n; // by-name blackout_view grant
const OTHER_CHAR = 97330004n; // an unrelated account
const ADMIN_CHAR = 97330005n; // flips the switch; never tracked
const characterIds = [MEMBER_CHAR, MEMBER_ALT, CLEARED_CHAR, OTHER_CHAR, ADMIN_CHAR];
const trackedIds = [MEMBER_CHAR, MEMBER_ALT, CLEARED_CHAR, OTHER_CHAR];

const MAP_NAME = 'User API Projection Map';
const SYSTEM_INTEL = 'projection-test system intel text';
const HIDDEN_INTEL = 'projection-test hidden system intel';

const accounts = { member: 0, cleared: 0, other: 0, admin: 0 };
let mapId = 0n;
const seeded = {
  liveConnection: '',
  dormantConnection: '',
  orphanConnection: '',
  visibleSig: '',
  hiddenSig: '',
  liveLog: '',
};
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

const RESOURCES: UserApiResource[] = ['map', 'signatures', 'pilots', 'notes', 'mass_log'];

async function viewerFor(userId: number): Promise<BlackoutViewer> {
  return { ...(await getBlackoutStatus(userId)), userId };
}

async function setSwitch(on: boolean): Promise<void> {
  await db
    .update(apInstance)
    .set({ blackoutSince: on ? new Date() : null, blackoutByCharacterId: null })
    .where(eq(apInstance.id, 1));
}

/** Every object key anywhere inside `value`. */
function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

const ids = (list: bigint[]) => list.map(String).sort();

describe.skipIf(!run)('User API projections (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();
    await db.insert(apInstance).values({ id: 1 }).onConflictDoNothing();

    await db.insert(universeRegion).values({ id: REGION, name: 'Projection Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Projection Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'UAP A', security: 'C3' },
      { id: SYS_B, constellationId: CONSTELLATION, name: 'UAP B', security: 'C3' },
      { id: SYS_HIDDEN, constellationId: CONSTELLATION, name: 'UAP Hidden', security: 'C3' },
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
    await db
      .update(apUser)
      .set({ mainCharacterId: MEMBER_CHAR })
      .where(eq(apUser.id, accounts.member));
    await db.insert(apAccessGrant).values({
      principalKind: 'character',
      principalId: CLEARED_CHAR,
      scope: 'instance',
      mapId: null,
      capability: 'blackout_view',
    });

    const [m] = await db
      .insert(apMap)
      .values({ name: MAP_NAME, scope: 'wh', type: 'corp', ownerCorporationId: CORP })
      .returning({ id: apMap.id });
    mapId = m!.id;
    await db
      .insert(apMapCharacterTracking)
      .values(trackedIds.map((characterId) => ({ mapId, characterId })));

    const systems = await db
      .insert(apMapSystem)
      .values([
        { mapId, systemId: SYS_A, visible: true, positionX: 0, positionY: 0, intelNotes: SYSTEM_INTEL },
        { mapId, systemId: SYS_B, visible: true, positionX: 100, positionY: 0 },
        { mapId, systemId: SYS_HIDDEN, visible: false, positionX: 200, positionY: 0, intelNotes: HIDDEN_INTEL },
      ])
      .returning({ id: apMapSystem.id, systemId: apMapSystem.systemId });
    const sys = (id: number) => systems.find((s) => s.systemId === id)!.id;

    const conns = await db
      .insert(apMapConnection)
      .values([
        { mapId, sourceMapSystemId: sys(SYS_A), targetMapSystemId: sys(SYS_B), scope: 'wh', massStatus: 'fresh', confirmedAt: new Date() },
        { mapId, sourceMapSystemId: sys(SYS_A), targetMapSystemId: sys(SYS_B), scope: 'wh', massStatus: 'fresh', confirmedAt: null },
        { mapId, sourceMapSystemId: sys(SYS_A), targetMapSystemId: sys(SYS_HIDDEN), scope: 'wh', massStatus: 'fresh', confirmedAt: new Date() },
      ])
      .returning({ id: apMapConnection.id });
    seeded.liveConnection = conns[0]!.id.toString();
    seeded.dormantConnection = conns[1]!.id.toString();
    seeded.orphanConnection = conns[2]!.id.toString();

    const expiresAt = new Date(Date.now() + 86_400_000);
    const sigs = await db
      .insert(apMapSignature)
      .values([
        { mapSystemId: sys(SYS_A), sigId: 'UAA', expiresAt },
        { mapSystemId: sys(SYS_HIDDEN), sigId: 'UAH', expiresAt },
      ])
      .returning({ id: apMapSignature.id });
    seeded.visibleSig = sigs[0]!.id.toString();
    seeded.hiddenSig = sigs[1]!.id.toString();

    await db.insert(apMapNote).values({ mapId, title: 'Projection note', createdByCharacterId: MEMBER_CHAR });

    const logs = await db
      .insert(apMapConnectionLog)
      .values([
        { connectionId: conns[0]!.id, characterId: OTHER_CHAR, mass: 10_000_000n },
        { connectionId: conns[1]!.id, characterId: OTHER_CHAR, mass: 20_000_000n },
        { connectionId: conns[2]!.id, characterId: OTHER_CHAR, mass: 30_000_000n },
      ])
      .returning({ id: apMapConnectionLog.id });
    seeded.liveLog = logs[0]!.id.toString();
  });

  afterAll(async () => {
    await cleanup();
    if (instanceSnapshot) {
      await db
        .update(apInstance)
        .set({
          blackoutSince: instanceSnapshot.blackoutSince,
          blackoutByCharacterId: instanceSnapshot.blackoutByCharacterId,
        })
        .where(eq(apInstance.id, 1));
    } else {
      await db.delete(apInstance).where(eq(apInstance.id, 1));
    }
    clearUserApiProjections();
    clearUserApiAuthCache();
    await pool.end();
  });

  beforeEach(async () => {
    currentSession = null;
    clearUserApiProjections();
    clearUserApiAuthCache();
    await setSwitch(false);
  });

  describe('visibility predicates', () => {
    it('map holds exactly the systems and connections loadMapForView shows', async () => {
      const view = await loadMapForView(mapId, MEMBER_CHAR, accounts.member);
      const { data } = await loadUserApiProjection(mapId, 'map', await viewerFor(accounts.member));

      expect(data.map).toMatchObject({ id: mapId.toString(), name: MAP_NAME, scope: 'wh', type: 'corp' });
      expect(data.systems.map((s) => s.id)).toEqual(view!.systems.map((s) => s.id));
      expect(data.systems.map((s) => s.systemId).sort()).toEqual([SYS_A, SYS_B]);
      expect(data.connections.map((c) => c.id)).toEqual(view!.connections.map((c) => c.id));
      expect(data.connections.map((c) => c.id)).toEqual([seeded.liveConnection]);
    });

    it('signatures hold only those in visible systems, as loadMapForView does', async () => {
      const view = await loadMapForView(mapId, MEMBER_CHAR, accounts.member);
      const { data } = await loadUserApiProjection(mapId, 'signatures', await viewerFor(accounts.member));
      expect(data.map((s) => s.id)).toEqual(view!.signatures.map((s) => s.id));
      expect(data.map((s) => s.id)).toEqual([seeded.visibleSig]);
      expect(data[0]).toMatchObject({ sigId: 'UAA', systemId: SYS_A, systemName: 'UAP A' });
    });

    it('notes hold every map note and the intel notes of visible systems only', async () => {
      const view = await loadMapForView(mapId, MEMBER_CHAR, accounts.member);
      const { data } = await loadUserApiProjection(mapId, 'notes', await viewerFor(accounts.member));
      expect(data.notes.map((n) => n.id)).toEqual(view!.notes.map((n) => n.id));
      expect(data.notes[0]).toMatchObject({
        title: 'Projection note',
        createdByCharacterId: MEMBER_CHAR.toString(),
      });
      expect(data.systemNotes).toEqual([
        expect.objectContaining({ systemId: SYS_A, intelNotes: SYSTEM_INTEL }),
      ]);
    });

    it('mass_log holds only jumps through confirmed, visible connections', async () => {
      const { data, hidden } = await loadUserApiProjection(mapId, 'mass_log', await viewerFor(accounts.member));
      expect(hidden).toBeUndefined();
      expect(data.map((e) => e.id)).toEqual([seeded.liveLog]);
      expect(data[0]).toMatchObject({
        connectionId: seeded.liveConnection,
        sourceSystemId: SYS_A,
        targetSystemId: SYS_B,
        characterId: OTHER_CHAR.toString(),
        mass: 10_000_000,
        cumulativeMass: 10_000_000,
      });
    });
  });

  describe('wire contract', () => {
    it('no resource carries userId at any depth', async () => {
      const viewer = await viewerFor(accounts.member);
      for (const resource of RESOURCES) {
        const payload = await loadUserApiProjection(mapId, resource, viewer);
        expect(allKeys(payload).has('userId'), resource).toBe(false);
      }
    });

    it('map carries no intel-notes field or text', async () => {
      const payload = await loadUserApiProjection(mapId, 'map', await viewerFor(accounts.member));
      const keys = allKeys(payload);
      expect(keys.has('intelNotes')).toBe(false);
      const json = JSON.stringify(payload);
      expect(json).not.toContain(SYSTEM_INTEL);
      expect(json).not.toContain(HIDDEN_INTEL);
    });

    it('pilots carry character ids as strings and the account main', async () => {
      const { data } = await loadUserApiProjection(mapId, 'pilots', await viewerFor(accounts.member));
      const member = data.find((p) => p.characterId === MEMBER_ALT.toString());
      expect(member).toMatchObject({ mainCharacterId: MEMBER_CHAR.toString() });
    });
  });

  describe('Blackout', () => {
    it('while off, every token owner gets every pilot and the full mass log', async () => {
      const viewer = await viewerFor(accounts.member);
      const pilots = await loadUserApiProjection(mapId, 'pilots', viewer);
      expect(pilots.data.map((p) => p.characterId).sort()).toEqual(ids(trackedIds));
      const log = await loadUserApiProjection(mapId, 'mass_log', viewer);
      expect(log.hidden).toBeUndefined();
      expect(log.data).toHaveLength(1);
    });

    it("while on, an uncleared owner gets only their own account's pilots and a hidden mass log", async () => {
      await setSwitch(true);
      const viewer = await viewerFor(accounts.member);
      const pilots = await loadUserApiProjection(mapId, 'pilots', viewer);
      expect(pilots.data.map((p) => p.characterId).sort()).toEqual(ids([MEMBER_CHAR, MEMBER_ALT]));
      expect(await loadUserApiProjection(mapId, 'mass_log', viewer)).toEqual({ data: [], hidden: true });
    });

    it('while on, a cleared owner gets every pilot and the full mass log', async () => {
      await setSwitch(true);
      const viewer = await viewerFor(accounts.cleared);
      expect(viewer).toMatchObject({ active: true, cleared: true });
      const pilots = await loadUserApiProjection(mapId, 'pilots', viewer);
      expect(pilots.data.map((p) => p.characterId).sort()).toEqual(ids(trackedIds));
      const log = await loadUserApiProjection(mapId, 'mass_log', viewer);
      expect(log.hidden).toBeUndefined();
      expect(log.data).toHaveLength(1);
    });

    for (const [name, flip] of [
      ['adminStartBlackout', () => adminStartBlackout()],
      ['adminEndBlackout', () => adminEndBlackout()],
    ] as const) {
      it(`${name} empties the projection cache and the auth cache`, async () => {
        if (name === 'adminEndBlackout') await setSwitch(true);
        currentSession = {
          characterId: ADMIN_CHAR.toString(),
          user: { id: '0' },
        } as unknown as Session;

        const viewer = await viewerFor(accounts.member);
        const now = Date.now();
        const entry = await getUserApiProjection(mapId, 'pilots', viewer, now);
        expect(await getUserApiProjection(mapId, 'pilots', viewer, now)).toBe(entry);
        expect(__userApiProjectionCacheSize()).toBe(1);

        const authLoad = vi.fn(async () => null);
        await resolveUserApiToken('projection-test-hash', now, authLoad);
        await resolveUserApiToken('projection-test-hash', now, authLoad);
        expect(authLoad).toHaveBeenCalledTimes(1);

        expect(await flip()).toEqual({ ok: true });

        expect(__userApiProjectionCacheSize()).toBe(0);
        expect(await getUserApiProjection(mapId, 'pilots', viewer, now)).not.toBe(entry);
        await resolveUserApiToken('projection-test-hash', now, authLoad);
        expect(authLoad).toHaveBeenCalledTimes(2);
      });
    }
  });
});

function mkChar(id: bigint, userId: number, systemId: number) {
  return {
    id,
    userId,
    name: `Projection ${id.toString()}`,
    ownerHash: `projection-hash-${id.toString()}`,
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
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  await db
    .delete(apAccessGrant)
    .where(
      and(eq(apAccessGrant.principalKind, 'character'), inArray(apAccessGrant.principalId, characterIds)),
    );
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, characterIds));
  const userIds = [...new Set([...users.map((u) => u.userId), ...Object.values(accounts)])].filter(
    (id) => id !== 0,
  );
  if (userIds.length) {
    await db.update(apUser).set({ mainCharacterId: null }).where(inArray(apUser.id, userIds));
  }
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  if (userIds.length) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(universeSystem).where(inArray(universeSystem.id, systemIds));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
