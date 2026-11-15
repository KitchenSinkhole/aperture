// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Job, JobHelpers } from 'graphile-worker';
import type { Notification, PoolClient } from 'pg';
import { apertureConfig } from '../../../aperture.config';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apInstance,
  apJobRun,
  apMap,
  apMapCharacterTracking,
  apMapConnection,
  apMapConnectionLog,
  apMapEvent,
  apMapSystem,
  apUser,
  universeCategory,
  universeConstellation,
  universeGroup,
  universeRegion,
  universeSystem,
  universeType,
} from '@/db/schema';

vi.mock('@/lib/esi/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/esi/client')>();
  return { ...actual, esiCall: vi.fn() };
});

// The pilot's account is "viewing" the map, so with Blackout off the fold is
// free to add systems: anything that stays off the map is Blackout's doing.
vi.mock('@/lib/realtime/mapViewers', () => ({
  getMapViewerUserIds: vi.fn((): number[] => []),
}));

// Passthrough, so a case can flip the switch from inside the poll's own read.
vi.mock('@/lib/auth/blackout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/blackout')>();
  return { ...actual, getBlackoutState: vi.fn(actual.getBlackoutState) };
});

import { esiCall } from '@/lib/esi/client';
import { getMapViewerUserIds } from '@/lib/realtime/mapViewers';
import { getBlackoutState } from '@/lib/auth/blackout';
import { locationPoll } from '@/lib/jobs/tasks/locationPoll';
import {
  acquireLocationPollSuiteLock,
  releaseLocationPollSuiteLock,
} from './locationPollSuiteLock';

/**
 * Blackout on the location poll (real Postgres): while on, a tracked jump never
 * changes the map, but a jump through a confirmed `wh` hole already on it still
 * lands in its mass log. The `characterUpdate` breadcrumb is unaffected.
 *
 * `ap_instance` is a live singleton, so the switch is snapshotted in `beforeAll`
 * and restored in `afterAll`. Ids use a 9725xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test location-poll-blackout
 */
const run = process.env.RUN_DB_TESTS === '1';

const CHAR_ID = 97250001n;
const REGION = 97250001;
const CONSTELLATION = 97250001;
const SYS_A = 97250001; // k-space, on the map
const SYS_C = 97250002; // w-space, on the map, joined to A by a confirmed wh
const SYS_E = 97250003; // w-space, not on the map
const SYS_D = 97250004; // abyssal, not on the map
const SYS_F = 97250005; // w-space, on the map, joined to A by a dormant wh
const CATEGORY = 97250001;
const GROUP = 97250001;
const SHIP = 97250020;
const SHIP_MASS_KG = 1_000_000;
const MAP_NAME = 'blackout-poll-map';
const SECOND_MAP_NAME = 'blackout-poll-map-2';

let userId = 0;
let mapId = 0n;
let connAC = 0n;
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

let listener: PoolClient | undefined;
const notifications: Array<{ task?: string; load?: Record<string, unknown> }> = [];
const channel = () => `${apertureConfig.MAP_EVENT_NOTIFY_CHANNEL_PREFIX}${mapId.toString()}`;

const mockedEsiCall = vi.mocked(esiCall);

function mockEsi(systemId: number): void {
  mockedEsiCall.mockImplementation(async (opKey) => {
    if (opKey === 'getCharacterOnline') return { online: true };
    if (opKey === 'getCharacterLocation') return { solar_system_id: systemId };
    if (opKey === 'getCharacterShip') return { ship_type_id: SHIP, ship_item_id: 1, ship_name: 'Hull' };
    throw new Error(`unexpected opKey ${opKey}`);
  });
}

function helpers(): JobHelpers {
  return { addJob: vi.fn(async () => ({}) as Job) } as unknown as JobHelpers;
}

async function setSwitch(on: boolean): Promise<void> {
  await db
    .update(apInstance)
    .set({ blackoutSince: on ? new Date() : null, blackoutByCharacterId: null })
    .where(eq(apInstance.id, 1));
}

/** Run one tick for a jump from `from` to `to`, and return every notify it sent on the map channel. */
async function jump(from: number, to: number) {
  await db.update(apCharacter).set({ lastSystemId: from }).where(eq(apCharacter.id, CHAR_ID));
  mockEsi(to);
  notifications.length = 0;
  await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers());
  // Notifies are delivered in commit order, so once this sentinel arrives every
  // notify the tick sent has too.
  await db.execute(sql`SELECT pg_notify(${channel()}, ${JSON.stringify({ task: 'sentinel' })})`);
  await vi.waitFor(() => expect(notifications.some((n) => n.task === 'sentinel')).toBe(true));
  return notifications.filter((n) => n.task !== 'sentinel');
}

async function eventCount(): Promise<number> {
  const rows = await db.select({ id: apMapEvent.id }).from(apMapEvent).where(eq(apMapEvent.mapId, mapId));
  return rows.length;
}

async function logRows(): Promise<number> {
  const rows = await db
    .select({ id: apMapConnectionLog.id })
    .from(apMapConnectionLog)
    .innerJoin(apMapConnection, eq(apMapConnection.id, apMapConnectionLog.connectionId))
    .where(eq(apMapConnection.mapId, mapId));
  return rows.length;
}

async function visibleSystemIds(): Promise<number[]> {
  const rows = await db
    .select({ systemId: apMapSystem.systemId })
    .from(apMapSystem)
    .where(eq(apMapSystem.mapId, mapId));
  return rows.map((r) => r.systemId).sort();
}

async function lastNotes() {
  const [row] = await db
    .select({ notes: apJobRun.notes })
    .from(apJobRun)
    .where(eq(apJobRun.name, 'location-poll'))
    .orderBy(desc(apJobRun.startedAt))
    .limit(1);
  return row?.notes as Record<string, unknown> | undefined;
}

function breadcrumb(sent: typeof notifications) {
  const updates = sent.filter((n) => n.task === 'characterUpdate');
  expect(updates).toHaveLength(1);
  const load = { ...updates[0]!.load! };
  delete load.locationAt;
  return load;
}

describe.skipIf(!run)('location-poll under Blackout (real Postgres)', () => {
  beforeAll(async () => {
    await acquireLocationPollSuiteLock();
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Blackout Poll Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Blackout Poll Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'BLP A', security: 'H' },
      { id: SYS_C, constellationId: CONSTELLATION, name: 'J972502', security: 'C3' },
      { id: SYS_E, constellationId: CONSTELLATION, name: 'J972503', security: 'C3' },
      { id: SYS_D, constellationId: CONSTELLATION, name: 'BLP Abyss', security: 'A' },
      { id: SYS_F, constellationId: CONSTELLATION, name: 'J972505', security: 'C3' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'BLP Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'BLP Grp' });
    await db.insert(universeType).values({ id: SHIP, groupId: GROUP, name: 'BLP Ship', mass: SHIP_MASS_KG });

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    vi.mocked(getMapViewerUserIds).mockReturnValue([userId]);
    await db.insert(apCharacter).values({ id: CHAR_ID, userId, name: 'Blackout Pilot', ownerHash: 'oh-blp' });

    const [m] = await db
      .insert(apMap)
      .values({ scope: 'all', type: 'private', name: MAP_NAME, trackAbyssalJumps: true })
      .returning({ id: apMap.id });
    mapId = m!.id;
    const systems = await db
      .insert(apMapSystem)
      .values([
        { mapId, systemId: SYS_A, visible: true, positionX: 0, positionY: 0 },
        { mapId, systemId: SYS_C, visible: true, positionX: 400, positionY: 0 },
        { mapId, systemId: SYS_F, visible: true, positionX: 0, positionY: 400 },
      ])
      .returning({ id: apMapSystem.id, systemId: apMapSystem.systemId });
    const msId = (sys: number) => systems.find((s) => s.systemId === sys)!.id;
    const [c] = await db
      .insert(apMapConnection)
      .values({ mapId, sourceMapSystemId: msId(SYS_C), targetMapSystemId: msId(SYS_A), scope: 'wh' })
      .returning({ id: apMapConnection.id });
    connAC = c!.id;
    await db.insert(apMapConnection).values({
      mapId,
      sourceMapSystemId: msId(SYS_A),
      targetMapSystemId: msId(SYS_F),
      scope: 'wh',
      confirmedAt: null,
    });
    await db.insert(apMapCharacterTracking).values({ mapId, characterId: CHAR_ID });

    listener = await pool.connect();
    listener.on('notification', (msg: Notification) => {
      if (msg.channel !== channel() || !msg.payload) return;
      notifications.push(JSON.parse(msg.payload) as (typeof notifications)[number]);
    });
    await listener.query(`LISTEN "${channel()}"`);
  }, 120_000);

  afterAll(async () => {
    if (listener) {
      await listener.query('UNLISTEN *');
      listener.release();
    }
    if (instanceSnapshot) {
      await db
        .update(apInstance)
        .set({
          blackoutSince: instanceSnapshot.blackoutSince,
          blackoutByCharacterId: instanceSnapshot.blackoutByCharacterId,
        })
        .where(eq(apInstance.id, 1));
    }
    await cleanup();
    if (userId) await db.delete(apUser).where(eq(apUser.id, userId));
    await releaseLocationPollSuiteLock();
    await pool.end();
  });

  beforeEach(async () => {
    mockedEsiCall.mockReset();
    // location-poll samples successful job-run rows; pin the sampler so every
    // tick writes the row `lastNotes()` reads.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await setSwitch(true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(getBlackoutState).mockReset();
    vi.mocked(getMapViewerUserIds).mockReturnValue([userId]);
    await setSwitch(false);
    await db.delete(apMapConnectionLog).where(eq(apMapConnectionLog.connectionId, connAC));
    await db.delete(apMapEvent).where(eq(apMapEvent.mapId, mapId));
    await db.delete(apJobRun).where(eq(apJobRun.name, 'location-poll'));
  });

  it('logs a jump through a confirmed wh on the map, with its notify, and writes no map event', async () => {
    const sent = await jump(SYS_A, SYS_C);

    expect(await logRows()).toBe(1);
    const massLogs = sent.filter((n) => n.task === 'connectionMassLog');
    expect(massLogs).toHaveLength(1);
    expect(await eventCount()).toBe(0);
    expect(await lastNotes()).toMatchObject({
      jumpClass: 'wormhole',
      blackout: { mapsSkipped: 1, massLogged: 1 },
    });
    expect((await lastNotes())!.folds).toBeUndefined();
  });

  it('writes nothing for a jump with an endpoint off the map', async () => {
    const sent = await jump(SYS_C, SYS_E);

    expect(await logRows()).toBe(0);
    expect(sent.filter((n) => n.task === 'connectionMassLog')).toHaveLength(0);
    expect(await eventCount()).toBe(0);
    expect(await visibleSystemIds()).toEqual([SYS_A, SYS_C, SYS_F].sort());
    expect(await lastNotes()).toMatchObject({ blackout: { mapsSkipped: 1, massLogged: 0 } });
  });

  it('writes nothing for a jump through a dormant connection, and leaves it dormant', async () => {
    await jump(SYS_A, SYS_F);

    expect(await logRows()).toBe(0);
    expect(await eventCount()).toBe(0);
    const dormant = await db
      .select({ confirmedAt: apMapConnection.confirmedAt })
      .from(apMapConnection)
      .where(eq(apMapConnection.mapId, mapId));
    expect(dormant.filter((c) => c.confirmedAt === null)).toHaveLength(1);
  });

  it('writes nothing for an abyssal jump on a map tracking abyssal jumps', async () => {
    const sent = await jump(SYS_A, SYS_D);

    expect(await logRows()).toBe(0);
    expect(sent.filter((n) => n.task === 'connectionMassLog')).toHaveLength(0);
    expect(await eventCount()).toBe(0);
    expect(await visibleSystemIds()).toEqual([SYS_A, SYS_C, SYS_F].sort());
    expect(await lastNotes()).toMatchObject({
      jumpClass: 'abyssal',
      blackout: { mapsSkipped: 1, massLogged: 0 },
    });
  });

  it('sends the same characterUpdate breadcrumb on and off', async () => {
    const on = breadcrumb(await jump(SYS_A, SYS_C));
    await setSwitch(false);
    const off = breadcrumb(await jump(SYS_A, SYS_C));

    expect(on).toEqual(off);
    expect(on).toMatchObject({ characterId: Number(CHAR_ID), userId, online: true, systemId: SYS_C });
  });

  it('folds normally once off', async () => {
    await setSwitch(false);
    await jump(SYS_C, SYS_E);

    expect(await visibleSystemIds()).toContain(SYS_E);
    expect(await eventCount()).toBeGreaterThan(0);
    const notes = await lastNotes();
    expect(notes!.blackout).toBeUndefined();
    expect(notes!.folds).toHaveLength(1);

    // Undo the fold so later cases see the seeded map.
    await db.delete(apMapConnection).where(
      inArray(
        apMapConnection.targetMapSystemId,
        db.select({ id: apMapSystem.id }).from(apMapSystem).where(eq(apMapSystem.systemId, SYS_E)),
      ),
    );
    await db.delete(apMapSystem).where(eq(apMapSystem.systemId, SYS_E));
  });

  it('stops folding on the remaining maps when Blackout starts mid-tick', async () => {
    const [m2] = await db
      .insert(apMap)
      .values({ scope: 'all', type: 'private', name: SECOND_MAP_NAME, trackAbyssalJumps: true })
      .returning({ id: apMap.id });
    const secondMapId = m2!.id;
    await db
      .insert(apMapSystem)
      .values({ mapId: secondMapId, systemId: SYS_C, visible: true, positionX: 0, positionY: 0 });
    await db.insert(apMapCharacterTracking).values({ mapId: secondMapId, characterId: CHAR_ID });
    await setSwitch(false);

    // An admin starts Blackout while the first map folds, so only the poll's
    // read before the second map sees it.
    const actual = await vi.importActual<typeof import('@/lib/auth/blackout')>('@/lib/auth/blackout');
    vi.mocked(getBlackoutState)
      .mockImplementationOnce(actual.getBlackoutState)
      .mockImplementationOnce(async () => {
        await setSwitch(true);
        return actual.getBlackoutState();
      });

    try {
      await jump(SYS_C, SYS_E);

      const outcomes = await Promise.all(
        [mapId, secondMapId].map(async (id) => {
          const added = await db
            .select({ id: apMapSystem.id })
            .from(apMapSystem)
            .where(and(eq(apMapSystem.mapId, id), eq(apMapSystem.systemId, SYS_E)));
          const events = await db
            .select({ id: apMapEvent.id })
            .from(apMapEvent)
            .where(eq(apMapEvent.mapId, id));
          return { added: added.length > 0, events: events.length };
        }),
      );
      // Tracked maps come back unordered, so either map may be the one folded.
      expect(outcomes.filter((o) => o.added)).toHaveLength(1);
      const skipped = outcomes.find((o) => !o.added)!;
      expect(skipped.events).toBe(0);
      expect(vi.mocked(getBlackoutState)).toHaveBeenCalledTimes(2);

      const notes = await lastNotes();
      expect(notes!.folds).toHaveLength(1);
      expect(notes!.blackout).toEqual({ mapsSkipped: 1, massLogged: 0 });
    } finally {
      await db.delete(apMap).where(eq(apMap.id, secondMapId));
      await db.delete(apMapConnection).where(
        inArray(
          apMapConnection.targetMapSystemId,
          db.select({ id: apMapSystem.id }).from(apMapSystem).where(eq(apMapSystem.systemId, SYS_E)),
        ),
      );
      await db.delete(apMapSystem).where(eq(apMapSystem.systemId, SYS_E));
    }
  });
});

async function cleanup() {
  await db.delete(apJobRun).where(eq(apJobRun.name, 'location-poll'));
  await db.delete(apMapCharacterTracking).where(eq(apMapCharacterTracking.characterId, CHAR_ID));
  await db.delete(apMap).where(inArray(apMap.name, [MAP_NAME, SECOND_MAP_NAME]));
  await db.delete(apCharacter).where(eq(apCharacter.id, CHAR_ID));
  await db.delete(universeType).where(eq(universeType.id, SHIP));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db
    .delete(universeSystem)
    .where(inArray(universeSystem.id, [SYS_A, SYS_C, SYS_E, SYS_D, SYS_F]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
