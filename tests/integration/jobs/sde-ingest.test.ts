// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import type { JobHelpers } from 'graphile-worker';
import { db, pool } from '@/db/client';
import { apJobRun, apSdeState } from '@/db/schema';
import type { ApSdeState } from '@/types';

vi.mock('@/lib/jobs/sdeIngestChild', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/sdeIngestChild')>();
  return { ...actual, runSdeIngestChild: vi.fn() };
});

import { SDE_BUILD, SDE_RELEASE_DATE } from '@/lib/sde/ingest';
import { runSdeIngestChild } from '@/lib/jobs/sdeIngestChild';
import { sdeIngest } from '@/lib/jobs/tasks/sdeIngest';

const run = process.env.RUN_DB_TESTS === '1';
const FAKE_HELPERS = {} as unknown as JobHelpers;

const mockedChild = vi.mocked(runSdeIngestChild);

describe.skipIf(!run)('sde-ingest (real Postgres)', () => {
  let snapshot: ApSdeState | undefined;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    const [row] = await db.select().from(apSdeState).where(eq(apSdeState.id, 1));
    snapshot = row;
  });

  afterAll(async () => {
    await db.delete(apSdeState).where(eq(apSdeState.id, 1));
    if (snapshot) await db.insert(apSdeState).values(snapshot);
    await db.delete(apJobRun).where(eq(apJobRun.name, 'sde-ingest'));
    await pool.end();
  });

  beforeEach(() => {
    mockedChild.mockReset();
    mockedChild.mockResolvedValue({ build: 0, counts: {} });
  });

  afterEach(async () => {
    await db.delete(apJobRun).where(eq(apJobRun.name, 'sde-ingest'));
  });

  it('re-ingests the build the database holds, not the pin', async () => {
    const refreshed = SDE_BUILD + 1000;
    await seedState({ currentBuild: refreshed, currentReleaseDate: '2026-08-01' });

    await sdeIngest.run(null, FAKE_HELPERS);

    expect(mockedChild).toHaveBeenCalledWith({ build: refreshed, releaseDate: '2026-08-01' });
  });

  it('falls back to the pinned bootstrap build when no state row exists', async () => {
    await db.delete(apSdeState).where(eq(apSdeState.id, 1));

    await sdeIngest.run(null, FAKE_HELPERS);

    expect(mockedChild).toHaveBeenCalledWith({ build: SDE_BUILD, releaseDate: SDE_RELEASE_DATE });
  });

  it('records the failure on ap_sde_state when the child rejects', async () => {
    await seedState({ currentBuild: 100, currentReleaseDate: '2026-01-01' });
    mockedChild.mockRejectedValue(new Error('SDE download failed: HTTP 404'));

    await expect(sdeIngest.run(null, FAKE_HELPERS)).rejects.toThrow();

    const state = await readState();
    expect(state).toMatchObject({ currentBuild: 100, consecutiveFailures: 1 });
    expect(state!.failureReason).toContain('HTTP 404');
    expect(state!.failedAt).not.toBeNull();
  });

  it('creates the state row to record a failure when none exists', async () => {
    await db.delete(apSdeState).where(eq(apSdeState.id, 1));
    mockedChild.mockRejectedValue(new Error('SDE download failed: HTTP 404'));

    await expect(sdeIngest.run(null, FAKE_HELPERS)).rejects.toThrow();

    const state = await readState();
    expect(state).toMatchObject({ currentBuild: null, consecutiveFailures: 1 });
    expect(state!.failureReason).toContain('HTTP 404');
  });
});

async function seedState(row: Pick<ApSdeState, 'currentBuild' | 'currentReleaseDate'>) {
  await db.delete(apSdeState).where(eq(apSdeState.id, 1));
  await db.insert(apSdeState).values({ id: 1, ...row });
}

async function readState() {
  const [row] = await db.select().from(apSdeState).where(eq(apSdeState.id, 1));
  return row;
}
