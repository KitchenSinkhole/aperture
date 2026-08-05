// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import type { JobHelpers } from 'graphile-worker';
import { db, pool } from '@/db/client';
import { apJobRun, apSdeState } from '@/db/schema';
import type { ApSdeState } from '@/types';

vi.mock('@/lib/sde/ingest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sde/ingest')>();
  return { ...actual, fetchLatestSdeManifest: vi.fn() };
});

vi.mock('@/lib/jobs/sdeIngestChild', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/sdeIngestChild')>();
  return { ...actual, runSdeIngestChild: vi.fn() };
});

import { fetchLatestSdeManifest, SDE_BUILD, SDE_RELEASE_DATE } from '@/lib/sde/ingest';
import { runSdeIngestChild } from '@/lib/jobs/sdeIngestChild';
import { sdeRefresh } from '@/lib/jobs/tasks/sdeRefresh';

const run = process.env.RUN_DB_TESTS === '1';
const FAKE_HELPERS = {} as unknown as JobHelpers;

const mockedManifest = vi.mocked(fetchLatestSdeManifest);
const mockedChild = vi.mocked(runSdeIngestChild);

describe.skipIf(!run)('sde-refresh (real Postgres)', () => {
  let snapshot: ApSdeState | undefined;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    const [row] = await db.select().from(apSdeState).where(eq(apSdeState.id, 1));
    snapshot = row;
  });

  afterAll(async () => {
    await db.delete(apSdeState).where(eq(apSdeState.id, 1));
    if (snapshot) await db.insert(apSdeState).values(snapshot);
    await db.delete(apJobRun).where(eq(apJobRun.name, 'sde-refresh'));
    await pool.end();
  });

  beforeEach(() => {
    mockedManifest.mockReset();
    mockedChild.mockReset();
  });

  afterEach(async () => {
    await db.delete(apJobRun).where(eq(apJobRun.name, 'sde-refresh'));
  });

  it('checks the manifest and no-ops without ingesting when already current', async () => {
    await seedState({ currentBuild: 100, currentReleaseDate: '2026-01-01' });
    mockedManifest.mockResolvedValue({ build: 100, releaseDate: '2026-01-01' });

    await sdeRefresh.run(null, FAKE_HELPERS);

    expect(mockedChild).not.toHaveBeenCalled();
    const state = await readState();
    expect(state).toMatchObject({ currentBuild: 100, latestBuild: 100 });
    expect(state!.checkedAt).not.toBeNull();
  });

  it('ingests a newer build through the child wrapper', async () => {
    await seedState({ currentBuild: 100, currentReleaseDate: '2026-01-01' });
    mockedManifest.mockResolvedValue({ build: 200, releaseDate: '2026-02-01' });
    mockedChild.mockImplementation(async () => {
      // The real child (runIngest) records its own success onto ap_sde_state;
      // reproduce just enough of that here to assert the row it leaves behind.
      await db
        .update(apSdeState)
        .set({
          currentBuild: 200,
          currentReleaseDate: '2026-02-01',
          refreshedAt: new Date(),
          failedAt: null,
          failureReason: null,
          consecutiveFailures: 0,
        })
        .where(eq(apSdeState.id, 1));
      return { build: 200, counts: { systems: 1 } };
    });

    await sdeRefresh.run(null, FAKE_HELPERS);

    expect(mockedChild).toHaveBeenCalledWith({ build: 200, releaseDate: '2026-02-01' });
    const state = await readState();
    expect(state).toMatchObject({
      currentBuild: 200,
      latestBuild: 200,
      failedAt: null,
      consecutiveFailures: 0,
    });
  });

  it('stamps behind_since on the first check that sees a gap, holds it, and clears it on convergence', async () => {
    await seedState({ currentBuild: 100, currentReleaseDate: '2026-01-01' });
    mockedManifest.mockResolvedValue({ build: 200, releaseDate: '2026-02-01' });
    mockedChild.mockResolvedValue({ build: 200, counts: { systems: 1 } });

    await sdeRefresh.run(null, FAKE_HELPERS);
    const stamped = (await readState())!.behindSince;
    expect(stamped).not.toBeNull();

    // The child is mocked, so current_build stays at 100 and the second check
    // still sees the gap. The stamp must measure the age of the gap, not the
    // age of the most recent check.
    await sdeRefresh.run(null, FAKE_HELPERS);
    expect((await readState())!.behindSince).toEqual(stamped);

    mockedManifest.mockResolvedValue({ build: 100, releaseDate: '2026-01-01' });
    await sdeRefresh.run(null, FAKE_HELPERS);
    expect((await readState())!.behindSince).toBeNull();
  });

  it('records the failure and leaves current_build unchanged when the child rejects', async () => {
    await seedState({ currentBuild: 100, currentReleaseDate: '2026-01-01' });
    mockedManifest.mockResolvedValue({ build: 200, releaseDate: '2026-02-01' });
    mockedChild.mockRejectedValue(new Error('SDE build 200 shrinks beyond 5% on: universe_type'));

    await expect(sdeRefresh.run(null, FAKE_HELPERS)).rejects.toThrow();

    const state = await readState();
    expect(state).toMatchObject({ currentBuild: 100, consecutiveFailures: 1 });
    expect(state!.failureReason).toContain('shrinks beyond');
    expect(state!.failedAt).not.toBeNull();

    const [runRow] = await db
      .select()
      .from(apJobRun)
      .where(eq(apJobRun.name, 'sde-refresh'))
      .orderBy(sql`${apJobRun.startedAt} desc`)
      .limit(1);
    expect(runRow!.success).toBe(false);
  });

  it('clears a prior failure when the check converges without ingesting', async () => {
    await seedState({
      currentBuild: 100,
      currentReleaseDate: '2026-01-01',
      failedAt: new Date('2026-01-02T00:00:00Z'),
      failureReason: 'fetch failed',
      consecutiveFailures: 3,
    });
    mockedManifest.mockResolvedValue({ build: 100, releaseDate: '2026-01-01' });

    await sdeRefresh.run(null, FAKE_HELPERS);

    expect(mockedChild).not.toHaveBeenCalled();
    expect(await readState()).toMatchObject({
      failedAt: null,
      failureReason: null,
      consecutiveFailures: 0,
    });
  });

  it('leaves a prior failure standing when the check finds the instance behind', async () => {
    await seedState({
      currentBuild: 100,
      currentReleaseDate: '2026-01-01',
      failedAt: new Date('2026-01-02T00:00:00Z'),
      failureReason: 'fetch failed',
      consecutiveFailures: 3,
    });
    mockedManifest.mockResolvedValue({ build: 200, releaseDate: '2026-02-01' });
    // The child is mocked, so nothing writes the success that would clear these.
    mockedChild.mockResolvedValue({ build: 200, counts: { systems: 1 } });

    await sdeRefresh.run(null, FAKE_HELPERS);

    expect(await readState()).toMatchObject({ failureReason: 'fetch failed', consecutiveFailures: 3 });
  });

  it('seeds the row from the pinned build when absent, for a deployment upgrading in place', async () => {
    await db.delete(apSdeState).where(eq(apSdeState.id, 1));
    mockedManifest.mockResolvedValue({ build: SDE_BUILD, releaseDate: SDE_RELEASE_DATE });

    await sdeRefresh.run(null, FAKE_HELPERS);

    expect(mockedChild).not.toHaveBeenCalled();
    const state = await readState();
    expect(state).toMatchObject({ currentBuild: SDE_BUILD });
  });
});

async function seedState(
  row: Pick<ApSdeState, 'currentBuild' | 'currentReleaseDate'> &
    Partial<Pick<ApSdeState, 'failedAt' | 'failureReason' | 'consecutiveFailures'>>,
) {
  await db.delete(apSdeState).where(eq(apSdeState.id, 1));
  await db.insert(apSdeState).values({ id: 1, ...row });
}

async function readState() {
  const [row] = await db.select().from(apSdeState).where(eq(apSdeState.id, 1));
  return row;
}
