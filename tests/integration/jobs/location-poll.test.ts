// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { desc, eq } from 'drizzle-orm';
import type { Job, JobHelpers, TaskSpec } from 'graphile-worker';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apJobRun,
  apMap,
  apMapCharacterTracking,
  apUser,
} from '@/db/schema';
import { apertureConfig } from '../../../aperture.config';

// Mock the ESI client before any importer touches it.
vi.mock('@/lib/esi/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/esi/client')>();
  return { ...actual, esiCall: vi.fn() };
});

import { esiCall, EsiBreakerOpenError } from '@/lib/esi/client';
import { locationPoll, locationPollJobKey } from '@/lib/jobs/tasks/locationPoll';
import {
  acquireLocationPollSuiteLock,
  releaseLocationPollSuiteLock,
} from './locationPollSuiteLock';

/**
 * Coverage:
 *  - Handler persists last-known state from ESI mock.
 *  - Re-enqueues at the adaptive interval driven by the online flag.
 *  - Stops cleanly when tracking rows go away or the character isn't active.
 *  - Breaker-open re-enqueues at the offline interval and returns cleanly (no throw).
 *
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

const CHAR_ID = 93000001n;
const JITA = 30000142;
const TARGET_SYSTEM = 30000144;
const SHIP_TYPE_ID = 670;

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

async function lastRun() {
  const rows = await db
    .select()
    .from(apJobRun)
    .where(eq(apJobRun.name, 'location-poll'))
    .orderBy(desc(apJobRun.startedAt))
    .limit(1);
  return rows[0];
}

async function seedTracking(mapId: bigint) {
  await db.insert(apMapCharacterTracking).values({ mapId, characterId: CHAR_ID });
}

async function clearTracking() {
  await db.delete(apMapCharacterTracking).where(eq(apMapCharacterTracking.characterId, CHAR_ID));
}

describe.skipIf(!run)('Stage 12.1 location-poll (real Postgres)', () => {
  let userId = 0;
  let mapId = 0n;

  beforeAll(async () => {
    // Serialize against the other location-poll* files — they share the
    // `location-poll` job-run name (see locationPollSuiteLock.ts).
    await acquireLocationPollSuiteLock();
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await db.delete(apJobRun).where(eq(apJobRun.name, 'location-poll'));
    await db.delete(apCharacter).where(eq(apCharacter.id, CHAR_ID));
    await db.delete(apMap).where(eq(apMap.name, 'location-poll-test-map'));

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    await db.insert(apCharacter).values({
      id: CHAR_ID,
      userId,
      name: 'Location Poll Test',
      ownerHash: 'oh-loc',
    });
    const [m] = await db
      .insert(apMap)
      .values({ scope: 'all', type: 'private', name: 'location-poll-test-map' })
      .returning({ id: apMap.id });
    mapId = m!.id;
    // Generous timeout: a waiting file blocks here until the lock holder's
    // suite finishes and releases.
  }, 120_000);

  afterAll(async () => {
    await db.delete(apJobRun).where(eq(apJobRun.name, 'location-poll'));
    await clearTracking();
    await db.delete(apCharacter).where(eq(apCharacter.id, CHAR_ID));
    await db.delete(apMap).where(eq(apMap.id, mapId));
    await releaseLocationPollSuiteLock();
    await pool.end();
  });

  beforeEach(() => {
    mockedEsiCall.mockReset();
    // location-poll runs under 1-in-N success sampling (JOB_INSTRUMENTATION_SUCCESS_SAMPLE);
    // pin the sampler so every clean/success run deterministically writes its
    // ap_job_run row for the `lastRun()` assertions below.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTracking();
    await db
      .update(apCharacter)
      .set({
        status: 'active',
        lastSystemId: null,
        lastShipTypeId: null,
        lastOnline: null,
        lastLocationAt: null,
      })
      .where(eq(apCharacter.id, CHAR_ID));
    await db.delete(apJobRun).where(eq(apJobRun.name, 'location-poll'));
  });

  it('exits with no re-enqueue when the character has no tracking rows', async () => {
    const { helpers, captured } = makeHelpers();
    await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers);

    expect(captured).toHaveLength(0);
    const row = await lastRun();
    expect(row!.success).toBe(true);
    expect(row!.notes).toEqual({ stopped: 'no-tracking' });
    expect(mockedEsiCall).not.toHaveBeenCalled();
  });

  it('exits with no re-enqueue when the character status is not active', async () => {
    await seedTracking(mapId);
    await db.update(apCharacter).set({ status: 'kicked' }).where(eq(apCharacter.id, CHAR_ID));
    const { helpers, captured } = makeHelpers();

    await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers);

    expect(captured).toHaveLength(0);
    const row = await lastRun();
    expect(row!.notes).toEqual({ stopped: 'character-inactive' });
    expect(mockedEsiCall).not.toHaveBeenCalled();
  });

  it('offline tick stamps lastOnline=false and re-enqueues at the offline interval', async () => {
    await seedTracking(mapId);
    mockedEsiCall.mockImplementation(async (opKey) => {
      if (opKey === 'getCharacterOnline') return { online: false };
      throw new Error(`unexpected opKey ${opKey}`);
    });
    const { helpers, captured } = makeHelpers();

    await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers);

    const [character] = await db
      .select({ lastOnline: apCharacter.lastOnline, lastSystemId: apCharacter.lastSystemId })
      .from(apCharacter)
      .where(eq(apCharacter.id, CHAR_ID));
    expect(character!.lastOnline).toBe(false);
    expect(character!.lastSystemId).toBeNull(); // not refreshed when offline

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      identifier: 'location-poll',
      payload: { characterId: CHAR_ID.toString() },
      spec: expect.objectContaining({
        jobKey: locationPollJobKey(CHAR_ID),
        jobKeyMode: 'replace',
      }),
    });
    const delay = (captured[0]!.spec!.runAt as Date).getTime() - Date.now();
    expect(delay).toBeGreaterThan(apertureConfig.LOCATION_POLL_OFFLINE_MS - 1000);
    expect(delay).toBeLessThanOrEqual(apertureConfig.LOCATION_POLL_OFFLINE_MS + 1000);

    const row = await lastRun();
    expect(row!.success).toBe(true);
    expect(row!.notes).toMatchObject({
      online: false,
      reenqueuedInMs: apertureConfig.LOCATION_POLL_OFFLINE_MS,
    });
  });

  it('online tick persists location/ship and re-enqueues at the online interval', async () => {
    await seedTracking(mapId);
    // Prime previous location to a different system so previousSystemId shows in notes.
    await db
      .update(apCharacter)
      .set({ lastSystemId: JITA })
      .where(eq(apCharacter.id, CHAR_ID));
    mockedEsiCall.mockImplementation(async (opKey) => {
      if (opKey === 'getCharacterOnline') return { online: true };
      if (opKey === 'getCharacterLocation') return { solar_system_id: TARGET_SYSTEM };
      if (opKey === 'getCharacterShip') {
        return { ship_type_id: SHIP_TYPE_ID, ship_item_id: 1, ship_name: 'Test' };
      }
      throw new Error(`unexpected opKey ${opKey}`);
    });
    const { helpers, captured } = makeHelpers();

    await locationPoll.run({ characterId: CHAR_ID.toString() }, helpers);

    const [character] = await db
      .select({
        lastSystemId: apCharacter.lastSystemId,
        lastShipTypeId: apCharacter.lastShipTypeId,
        lastOnline: apCharacter.lastOnline,
        lastLocationAt: apCharacter.lastLocationAt,
      })
      .from(apCharacter)
      .where(eq(apCharacter.id, CHAR_ID));
    expect(character!.lastSystemId).toBe(TARGET_SYSTEM);
    expect(character!.lastShipTypeId).toBe(SHIP_TYPE_ID);
    expect(character!.lastOnline).toBe(true);
    expect(character!.lastLocationAt).toBeInstanceOf(Date);

    expect(captured).toHaveLength(1);
    const delay = (captured[0]!.spec!.runAt as Date).getTime() - Date.now();
    expect(delay).toBeGreaterThan(apertureConfig.LOCATION_POLL_ONLINE_MS - 1000);
    expect(delay).toBeLessThanOrEqual(apertureConfig.LOCATION_POLL_ONLINE_MS + 1000);

    const row = await lastRun();
    expect(row!.notes).toMatchObject({
      online: true,
      previousSystemId: JITA,
      currentSystemId: TARGET_SYSTEM,
      reenqueuedInMs: apertureConfig.LOCATION_POLL_ONLINE_MS,
    });
  });

  it('re-enqueues at the offline interval and returns cleanly when ESI breaker is open', async () => {
    await seedTracking(mapId);
    mockedEsiCall.mockImplementation(async () => {
      throw new EsiBreakerOpenError('get_characters_character_id_online');
    });
    const { helpers, captured } = makeHelpers();

    // A breaker-open tick must NOT throw: a throw walks graphile `attempts` on the
    // key-nulled row to max and mints a permanently-failed zombie. It re-enqueues
    // the offline-cadence retry and completes cleanly instead.
    await expect(
      locationPoll.run({ characterId: CHAR_ID.toString() }, helpers),
    ).resolves.toBeUndefined();

    expect(captured).toHaveLength(1);
    const delay = (captured[0]!.spec!.runAt as Date).getTime() - Date.now();
    expect(delay).toBeGreaterThan(apertureConfig.LOCATION_POLL_OFFLINE_MS - 1000);

    const row = await lastRun();
    expect(row!.success).toBe(true);
    expect((row!.notes as { esiOutage?: string }).esiOutage).toBe('breaker-open');
  });
});
