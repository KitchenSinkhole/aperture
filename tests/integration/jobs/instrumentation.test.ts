// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { desc, eq } from 'drizzle-orm';
import type { JobHelpers } from 'graphile-worker';
import { db, pool } from '@/db/client';
import { apJobRun } from '@/db/schema';
import { withInstrumentation } from '@/lib/jobs/withInstrumentation';
import { apertureConfig } from '../../../aperture.config';

/**
 * Smoke gate:
 *   "A minimal smoke-test task runs end-to-end through `withInstrumentation`,
 *    leaving one `ap_job_run` row."
 * Plus the failure path + the notes/error caps from withInstrumentation.ts.
 *
 * DB-gated like the rest of the multi-table integration tests:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';
const FAKE_HELPERS = {} as unknown as JobHelpers;

async function lastRunFor(name: string) {
  const rows = await db
    .select()
    .from(apJobRun)
    .where(eq(apJobRun.name, name))
    .orderBy(desc(apJobRun.startedAt))
    .limit(1);
  return rows[0];
}

describe.skipIf(!run)('withInstrumentation (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await db.delete(apJobRun);
  });

  afterAll(async () => {
    await db.delete(apJobRun);
    await pool.end();
  });

  it('records a successful run with notes from the return value', async () => {
    const task = withInstrumentation<unknown>('smoke-success', async () => ({ deleted: 7 }));
    await task(null, FAKE_HELPERS);

    const row = await lastRunFor('smoke-success');
    expect(row).toBeDefined();
    expect(row!.success).toBe(true);
    expect(row!.errorText).toBeNull();
    expect(row!.notes).toEqual({ deleted: 7 });
    expect(row!.endedAt).not.toBeNull();
    expect(row!.endedAt!.getTime()).toBeGreaterThanOrEqual(row!.startedAt.getTime());
  });

  it('records a failed run and re-throws so graphile-worker can retry', async () => {
    const boom = new Error('boom from smoke test');
    const task = withInstrumentation<unknown>('smoke-failure', async () => {
      throw boom;
    });

    await expect(task(null, FAKE_HELPERS)).rejects.toThrow('boom from smoke test');

    const row = await lastRunFor('smoke-failure');
    expect(row).toBeDefined();
    expect(row!.success).toBe(false);
    expect(row!.errorText).toBe('boom from smoke test');
    expect(row!.notes).toBeNull();
  });

  it('truncates oversize notes into a marker rather than dropping the row', async () => {
    const big = 'x'.repeat(apertureConfig.JOB_INSTRUMENTATION_NOTES_MAX_BYTES + 1000);
    const task = withInstrumentation<unknown>('smoke-oversize-notes', async () => ({ big }));
    await task(null, FAKE_HELPERS);

    const row = await lastRunFor('smoke-oversize-notes');
    expect(row!.success).toBe(true);
    expect(row!.notes).toMatchObject({ truncated: true });
    expect((row!.notes as { originalLength: number }).originalLength).toBeGreaterThan(
      apertureConfig.JOB_INSTRUMENTATION_NOTES_MAX_BYTES,
    );
  });

  it('caps very large error messages', async () => {
    const huge = 'e'.repeat(apertureConfig.JOB_INSTRUMENTATION_ERROR_MAX_LENGTH + 500);
    const task = withInstrumentation<unknown>('smoke-oversize-error', async () => {
      throw new Error(huge);
    });

    await expect(task(null, FAKE_HELPERS)).rejects.toThrow();
    const row = await lastRunFor('smoke-oversize-error');
    expect(row!.errorText?.length).toBe(apertureConfig.JOB_INSTRUMENTATION_ERROR_MAX_LENGTH);
  });

  describe('success sampling (successSampleRate > 1)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('persists a sampled-in success weighted by the sample rate', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0); // 0 * N < 1 → always persist
      const task = withInstrumentation<unknown>('smoke-sampled-hit', async () => ({ ok: true }), {
        successSampleRate: 50,
      });
      await task(null, FAKE_HELPERS);

      const row = await lastRunFor('smoke-sampled-hit');
      expect(row).toBeDefined();
      expect(row!.success).toBe(true);
      expect(row!.weight).toBe(50);
      expect(row!.endedAt).not.toBeNull();
      expect(row!.notes).toEqual({ ok: true });
    });

    it('writes no row for a sampled-out success', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.9); // 0.9 * 50 ≥ 1 → drop
      const task = withInstrumentation<unknown>('smoke-sampled-miss', async () => ({ ok: true }), {
        successSampleRate: 50,
      });
      await task(null, FAKE_HELPERS);

      expect(await lastRunFor('smoke-sampled-miss')).toBeUndefined();
    });

    it('always persists a failure at weight 1 and re-throws, even when sampling', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.9); // would drop a success
      const task = withInstrumentation<unknown>(
        'smoke-sampled-failure',
        async () => {
          throw new Error('sampled boom');
        },
        { successSampleRate: 50 },
      );

      await expect(task(null, FAKE_HELPERS)).rejects.toThrow('sampled boom');

      const row = await lastRunFor('smoke-sampled-failure');
      expect(row).toBeDefined();
      expect(row!.success).toBe(false);
      expect(row!.weight).toBe(1);
      expect(row!.errorText).toBe('sampled boom');
      expect(row!.endedAt).not.toBeNull();
    });
  });
});
