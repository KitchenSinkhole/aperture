// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Job, JobHelpers, TaskSpec } from 'graphile-worker';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apJobRun,
  apMap,
  apMapCharacterTracking,
  apMapConnection,
  apMapEvent,
  apMapSystem,
  apUser,
  universeConstellation,
  universeRegion,
  universeStargateEdge,
  universeSystem,
} from '@/db/schema';

vi.mock('@/lib/esi/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/esi/client')>();
  return { ...actual, esiCall: vi.fn() };
});

// The fold's `addNewSystems` gate asks whether the moving pilot's account has
// this map open in a live WS socket. That roster is in-process and empty under
// test, so without a mock every wormhole jump would be suppressed. Treat the
// tracked pilot as present on every map (set per-suite once `userId` is known).
vi.mock('@/lib/realtime/mapViewers', () => ({
  getMapViewerUserIds: vi.fn((): number[] => []),
}));

import { esiCall } from '@/lib/esi/client';
import { getMapViewerUserIds } from '@/lib/realtime/mapViewers';
import { locationPoll } from '@/lib/jobs/tasks/locationPoll';
import { SLOT_X, SLOT_Y, overlaps, snapToGrid } from '@/lib/map/placement';
import {
  acquireLocationPollSuiteLock,
  releaseLocationPollSuiteLock,
} from './locationPollSuiteLock';

async function systemPos(mapId: bigint, systemId: number): Promise<{ x: number; y: number }> {
  const [row] = await db
    .select({ x: apMapSystem.positionX, y: apMapSystem.positionY })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.systemId, systemId)));
  return { x: row!.x, y: row!.y };
}

/**
 * Coverage:
 *  - Gate jump (between two `universe_stargate_edge`-linked systems) writes
 *    nothing — `ap_map_event` row count for the map is unchanged.
 *  - Wormhole jump (no edge between the systems) writes exactly three events
 *    per active tracked map (`system.added` × 2 + `connection.create`).
 *  - Teleport (docked arrival in k-space: pod self-destruct / jump clone) writes
 *    nothing — `jumpClass: 'teleport'`, no fold. A docked arrival in a w-space
 *    system is still a real wormhole (the teleport branch is k-space-gated).
 *  - Re-running the same wormhole jump is idempotent: no new events.
 *  - Soft-deleted maps are excluded from the fan-out.
 *
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

const CHAR_ID = 94000001n;
const REGION = 98120001;
const CONSTELLATION = 98120001;
const SYS_A = 98120001; // K-space (Jita-like)
const SYS_B = 98120002; // K-space, gate-adjacent to SYS_A
const SYS_C = 98120003; // WH-like; NOT gate-adjacent to anything

interface CapturedJob {
  identifier: string;
  payload: unknown;
  spec?: TaskSpec;
}
function makeHelpers(): { helpers: JobHelpers; captured: CapturedJob[] } {
  const captured: CapturedJob[] = [];
  const helpers = {
    addJob: vi.fn(async (identifier: string, payload: unknown, spec?: TaskSpec) => {
      captured.push({ identifier, payload, spec });
      return {} as Job;
    }),
  } as unknown as JobHelpers;
  return { helpers, captured };
}

const mockedEsiCall = vi.mocked(esiCall);

function mockEsi(opts: {
  online: boolean;
  systemId?: number;
  shipTypeId?: number;
  stationId?: number;
  structureId?: number;
}): void {
  mockedEsiCall.mockImplementation(async (opKey) => {
    if (opKey === 'getCharacterOnline') return { online: opts.online };
    if (opKey === 'getCharacterLocation') {
      // station_id / structure_id present only when docked — drives `arrivedDocked`.
      return {
        solar_system_id: opts.systemId,
        ...(opts.stationId != null ? { station_id: opts.stationId } : {}),
        ...(opts.structureId != null ? { structure_id: opts.structureId } : {}),
      };
    }
    if (opKey === 'getCharacterShip') {
      return {
        ship_type_id: opts.shipTypeId ?? 670,
        ship_item_id: 1,
        ship_name: 'Test',
      };
    }
    throw new Error(`unexpected opKey ${opKey}`);
  });
}

async function eventCount(mapId: bigint): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM ap_map_event WHERE map_id = ${mapId}`,
  );
  return result.rows[0]!.count;
}

async function eventKinds(mapId: bigint): Promise<string[]> {
  const rows = await db
    .select({ kind: apMapEvent.kind })
    .from(apMapEvent)
    .where(eq(apMapEvent.mapId, mapId))
    .orderBy(apMapEvent.occurredAt);
  return rows.map((r) => r.kind);
}

async function lastJobNotes() {
  const [row] = await db
    .select({ notes: apJobRun.notes })
    .from(apJobRun)
    .where(eq(apJobRun.name, 'location-poll'))
    .orderBy(desc(apJobRun.startedAt))
    .limit(1);
  return row?.notes as Record<string, unknown> | undefined;
}

describe.skipIf(!run)('Stage 12.2 location-poll jump classification + fan-out (real Postgres)', () => {
  let userId = 0;
  let mapA = 0n;
  let mapB = 0n;

  beforeAll(async () => {
    // Serialize against the other location-poll* files — they share the
    // `location-poll` job-run name (see locationPollSuiteLock.ts).
    await acquireLocationPollSuiteLock();
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Jumps Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Jumps Test Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'Jumps A', security: 'H' },
      { id: SYS_B, constellationId: CONSTELLATION, name: 'Jumps B', security: 'H' },
      { id: SYS_C, constellationId: CONSTELLATION, name: 'J133003', security: 'C3' },
    ]);
    // Bidirectional gate pair A↔B; no edges touching C.
    await db.insert(universeStargateEdge).values([
      { fromSystemId: SYS_A, toSystemId: SYS_B },
      { fromSystemId: SYS_B, toSystemId: SYS_A },
    ]);

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    // Pilot's account is "viewing" every map → the presence gate lets the fold add systems.
    vi.mocked(getMapViewerUserIds).mockReturnValue([userId]);
    await db.insert(apCharacter).values({
      id: CHAR_ID,
      userId,
      name: 'Jump Test',
      ownerHash: 'oh-jump',
    });

    const [a] = await db
      .insert(apMap)
      .values({ scope: 'all', type: 'private', name: 'jumps-test-map-a' })
      .returning({ id: apMap.id });
    mapA = a!.id;
    const [b] = await db
      .insert(apMap)
      .values({ scope: 'all', type: 'private', name: 'jumps-test-map-b' })
      .returning({ id: apMap.id });
    mapB = b!.id;

    await db.insert(apMapCharacterTracking).values([
      { mapId: mapA, characterId: CHAR_ID },
      { mapId: mapB, characterId: CHAR_ID },
    ]);
    // Generous timeout: a waiting file blocks here until the lock holder's
    // suite finishes and releases.
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await releaseLocationPollSuiteLock();
    await pool.end();
  });

  beforeEach(() => {
    mockedEsiCall.mockReset();
    // location-poll runs under 1-in-N success sampling (JOB_INSTRUMENTATION_SUCCESS_SAMPLE);
    // pin the sampler so every success run deterministically writes its ap_job_run
    // row for the `lastJobNotes()` assertions below.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Wipe the per-map canvas + history so each `it` starts from a clean slate.
    // ap_map_signature is empty for these tests; nothing else to scrub.
    await db.delete(apMapConnection).where(inArray(apMapConnection.mapId, [mapA, mapB]));
    await db.delete(apMapSystem).where(inArray(apMapSystem.mapId, [mapA, mapB]));
    await db.delete(apMapEvent).where(inArray(apMapEvent.mapId, [mapA, mapB]));
    await db.delete(apJobRun).where(eq(apJobRun.name, 'location-poll'));
    // Reset character so each test controls `previousSystemId` explicitly.
    await db
      .update(apCharacter)
      .set({ lastSystemId: null, lastShipTypeId: null, lastOnline: null, lastLocationAt: null })
      .where(eq(apCharacter.id, CHAR_ID));
    // Unsoft-delete in case a previous test toggled it.
    await db.update(apMap).set({ deletedAt: null }).where(inArray(apMap.id, [mapA, mapB]));
    // Re-seed tracking rows in case a previous test removed them.
    await db
      .insert(apMapCharacterTracking)
      .values([
        { mapId: mapA, characterId: CHAR_ID },
        { mapId: mapB, characterId: CHAR_ID },
      ])
      .onConflictDoNothing();
  });

  it('first tick with no prior location writes nothing but persists current', async () => {
    mockEsi({ online: true, systemId: SYS_A });
    const { helpers } = makeHelpers();
    await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers);

    expect(await eventCount(mapA)).toBe(0);
    expect(await eventCount(mapB)).toBe(0);

    const notes = await lastJobNotes();
    expect(notes).toMatchObject({
      online: true,
      previousSystemId: null,
      currentSystemId: SYS_A,
      jumpClass: null,
    });
  });

  it('gate jump (A→B) emits no events and classifies as gate', async () => {
    await db.update(apCharacter).set({ lastSystemId: SYS_A }).where(eq(apCharacter.id, CHAR_ID));
    mockEsi({ online: true, systemId: SYS_B });
    const { helpers } = makeHelpers();

    await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers);

    expect(await eventCount(mapA)).toBe(0);
    expect(await eventCount(mapB)).toBe(0);

    const notes = await lastJobNotes();
    expect(notes).toMatchObject({
      jumpClass: 'gate',
      previousSystemId: SYS_A,
      currentSystemId: SYS_B,
    });
    expect(notes!.folds).toBeUndefined();
  });

  it('wormhole jump (B→C) emits three events per active tracked map', async () => {
    await db.update(apCharacter).set({ lastSystemId: SYS_B }).where(eq(apCharacter.id, CHAR_ID));
    mockEsi({ online: true, systemId: SYS_C });
    const { helpers } = makeHelpers();

    await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers);

    expect(await eventKinds(mapA)).toEqual(['system.added', 'system.added', 'connection.create']);
    expect(await eventKinds(mapB)).toEqual(['system.added', 'system.added', 'connection.create']);

    const [conn] = await db
      .select({
        scope: apMapConnection.scope,
        massStatus: apMapConnection.massStatus,
        eolStage: apMapConnection.eolStage,
      })
      .from(apMapConnection)
      .where(eq(apMapConnection.mapId, mapA));
    expect(conn).toMatchObject({ scope: 'wh', massStatus: 'fresh', eolStage: 'none' });

    const notes = await lastJobNotes();
    expect(notes!.jumpClass).toBe('wormhole');
    expect(notes!.folds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromSystemAdded: true,
          toSystemAdded: true,
          connectionCreated: true,
        }),
      ]),
    );

    // Placement: the destination (C) lands on its own grid-aligned slot,
    // adjacent to the parent (B) it was reached through — not piled on top of it.
    const posB = await systemPos(mapA, SYS_B);
    const posC = await systemPos(mapA, SYS_C);
    expect(snapToGrid(posC)).toEqual(posC);
    expect(overlaps(posB, posC)).toBe(false);
    // "Adjacent" = within the first placement ring of the parent on each axis.
    expect(Math.abs(posC.x - posB.x)).toBeLessThanOrEqual(SLOT_X);
    expect(Math.abs(posC.y - posB.y)).toBeLessThanOrEqual(SLOT_Y);
  });

  it('pod self-destruct (C→A, arrived docked in k-space) classifies as teleport and folds nothing', async () => {
    // Non-gate-adjacent C→A would normally be a wormhole, but the pilot arrives
    // docked at a k-space station — a medical-clone teleport, not a traversal.
    await db.update(apCharacter).set({ lastSystemId: SYS_C }).where(eq(apCharacter.id, CHAR_ID));
    mockEsi({ online: true, systemId: SYS_A, stationId: 60000001 });
    const { helpers } = makeHelpers();

    await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers);

    expect(await eventCount(mapA)).toBe(0);
    expect(await eventCount(mapB)).toBe(0);

    const notes = await lastJobNotes();
    expect(notes).toMatchObject({
      jumpClass: 'teleport',
      previousSystemId: SYS_C,
      currentSystemId: SYS_A,
    });
    expect(notes!.folds).toBeUndefined();
  });

  it('arriving docked in a wormhole system still folds (clones cannot live in w-space)', async () => {
    // B→C is non-gate-adjacent and C is w-space (C3): even a docked arrival is a
    // real wormhole, since the k-space gate excludes it from the teleport branch.
    await db.update(apCharacter).set({ lastSystemId: SYS_B }).where(eq(apCharacter.id, CHAR_ID));
    mockEsi({ online: true, systemId: SYS_C, structureId: 1035000000001 });
    const { helpers } = makeHelpers();

    await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers);

    expect(await eventKinds(mapA)).toEqual(['system.added', 'system.added', 'connection.create']);

    const notes = await lastJobNotes();
    expect(notes!.jumpClass).toBe('wormhole');
  });

  it('re-adding a previously-hidden system re-places it off the new parent, not at its stale coords', async () => {
    // Prime the map with a B→C jump, then shove C to a far-off spot and hide it —
    // simulating a now-defunct chain where C sat somewhere unrelated.
    await db.update(apCharacter).set({ lastSystemId: SYS_B }).where(eq(apCharacter.id, CHAR_ID));
    mockEsi({ online: true, systemId: SYS_C });
    await locationPoll.run({ characterId: CHAR_ID.toString() }, makeHelpers().helpers);

    const stale = { x: 1234, y: -5678 };
    await db
      .update(apMapSystem)
      .set({ positionX: stale.x, positionY: stale.y, visible: false })
      .where(and(eq(apMapSystem.mapId, mapA), eq(apMapSystem.systemId, SYS_C)));

    // Re-fire the same jump; C re-adds through the onConflictDoUpdate path and must
    // be re-placed adjacent to its parent (B), not restored to the stale coords.
    await db.update(apCharacter).set({ lastSystemId: SYS_B }).where(eq(apCharacter.id, CHAR_ID));
    await locationPoll.run({ characterId: CHAR_ID.toString() }, makeHelpers().helpers);

    const posB = await systemPos(mapA, SYS_B);
    const posC = await systemPos(mapA, SYS_C);
    expect(posC).not.toEqual(stale);
    expect(snapToGrid(posC)).toEqual(posC);
    expect(overlaps(posB, posC)).toBe(false);
    // Re-placed within the first placement ring of the parent on each axis.
    expect(Math.abs(posC.x - posB.x)).toBeLessThanOrEqual(SLOT_X);
    expect(Math.abs(posC.y - posB.y)).toBeLessThanOrEqual(SLOT_Y);
  });

  it('repeated wormhole jump is idempotent (no new events)', async () => {
    // First pass — primes the maps.
    await db.update(apCharacter).set({ lastSystemId: SYS_B }).where(eq(apCharacter.id, CHAR_ID));
    mockEsi({ online: true, systemId: SYS_C });
    await locationPoll.run({ characterId: CHAR_ID.toString() }, makeHelpers().helpers);
    const baselineA = await eventCount(mapA);
    const baselineB = await eventCount(mapB);
    expect(baselineA).toBe(3);

    // Second pass with the same source→target — handler treats lastSystemId=SYS_C
    // (persisted by the first call) → SYS_C as a no-op (same system), so reset
    // last back to SYS_B and re-fire.
    await db.update(apCharacter).set({ lastSystemId: SYS_B }).where(eq(apCharacter.id, CHAR_ID));
    await locationPoll.run({ characterId: CHAR_ID.toString() }, makeHelpers().helpers);

    expect(await eventCount(mapA)).toBe(baselineA); // no new events
    expect(await eventCount(mapB)).toBe(baselineB);

    const notes = await lastJobNotes();
    expect(notes!.jumpClass).toBe('wormhole');
    expect(notes!.folds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromSystemAdded: false,
          toSystemAdded: false,
          connectionCreated: false,
        }),
      ]),
    );
  });

  it('jumping a dormant connection re-confirms it (regression: removed+re-added system)', async () => {
    // Prime a B→C jump so the connection exists, then dormant it the way
    // removeSystem(B) would (NULL confirmed_at) without deleting the row —
    // re-adding B leaves the wh link hidden. The pilot jumping B→C again must
    // bring it back, not silently treat the dormant row as already-present.
    await db.update(apCharacter).set({ lastSystemId: SYS_B }).where(eq(apCharacter.id, CHAR_ID));
    mockEsi({ online: true, systemId: SYS_C });
    await locationPoll.run({ characterId: CHAR_ID.toString() }, makeHelpers().helpers);

    await db
      .update(apMapConnection)
      .set({ confirmedAt: null })
      .where(eq(apMapConnection.mapId, mapA));
    const baselineA = await eventCount(mapA);

    // Re-fire the same jump.
    await db.update(apCharacter).set({ lastSystemId: SYS_B }).where(eq(apCharacter.id, CHAR_ID));
    await locationPoll.run({ characterId: CHAR_ID.toString() }, makeHelpers().helpers);

    // The dormant edge is re-confirmed and re-broadcast as connection.create.
    expect(await eventCount(mapA)).toBe(baselineA + 1);
    const [conn] = await db
      .select({ confirmedAt: apMapConnection.confirmedAt })
      .from(apMapConnection)
      .where(eq(apMapConnection.mapId, mapA));
    expect(conn!.confirmedAt).not.toBeNull();

    const notes = await lastJobNotes();
    expect(notes!.folds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ connectionCreated: true }),
      ]),
    );
  });

  it('soft-deleted maps are excluded from the fan-out', async () => {
    await db.update(apMap).set({ deletedAt: sql`now()` }).where(eq(apMap.id, mapB));
    await db.update(apCharacter).set({ lastSystemId: SYS_B }).where(eq(apCharacter.id, CHAR_ID));
    mockEsi({ online: true, systemId: SYS_C });

    await locationPoll.run({ characterId: CHAR_ID.toString() }, makeHelpers().helpers);

    expect(await eventCount(mapA)).toBe(3);
    expect(await eventCount(mapB)).toBe(0);

    const notes = await lastJobNotes();
    const folds = notes!.folds as Array<{ mapId: string }>;
    expect(folds).toHaveLength(1);
    expect(folds[0]!.mapId).toBe(mapA.toString());
  });
});

async function cleanup() {
  await db.delete(apJobRun).where(eq(apJobRun.name, 'location-poll'));
  await db
    .delete(apMapCharacterTracking)
    .where(eq(apMapCharacterTracking.characterId, CHAR_ID));
  await db
    .delete(apMap)
    .where(and(sql`name like 'jumps-test-map-%'`, isNull(apMap.deletedAt)));
  // Also delete any soft-deleted ones a prior run left behind.
  await db.delete(apMap).where(sql`name like 'jumps-test-map-%'`);
  await db.delete(apCharacter).where(eq(apCharacter.id, CHAR_ID));
  await db
    .delete(universeStargateEdge)
    .where(
      inArray(universeStargateEdge.fromSystemId, [SYS_A, SYS_B, SYS_C]),
    );
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYS_A, SYS_B, SYS_C]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
