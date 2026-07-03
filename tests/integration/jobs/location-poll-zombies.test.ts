// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '@/db/client';
import { reapExhaustedLocationPollZombies } from '@/lib/jobs/runner';
import { countJobBacklog } from '@/lib/metrics/gauges';

/**
 * Graphile-level guarantees behind the location-poll zombie fix, exercised
 * against the real `graphile_worker._private_jobs` table:
 *   - `reapExhaustedLocationPollZombies` deletes exhausted NULL-key location-poll
 *     rows but spares the one live keyed job.
 *   - `countJobBacklog` excludes permanently-failed rows (`attempts >= max_attempts`)
 *     from the backlog reading while still counting genuinely runnable ones.
 *
 * These drive the SQL directly (no handler run), so they don't share the
 * `ap_job_run` name the other location-poll suites clean up — no suite lock.
 *
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

const FAR_FUTURE = () => new Date(Date.now() + 86_400_000).toISOString();

describe.skipIf(!run)('location-poll zombie reap + backlog gauge (real Postgres)', () => {
  const createdIds: string[] = [];

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
  });

  afterEach(async () => {
    if (createdIds.length) {
      await pool.query('DELETE FROM graphile_worker._private_jobs WHERE id = ANY($1::bigint[])', [
        createdIds,
      ]);
      createdIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Enqueue a real location-poll job via graphile's own `add_job`; track its id for cleanup. */
  async function addLocationPollJob(opts: {
    jobKey?: string;
    maxAttempts?: number;
    runAt?: string;
  }): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM graphile_worker.add_job(
         'location-poll',
         payload := '{}'::json,
         run_at := $1,
         max_attempts := $2,
         job_key := $3)`,
      [opts.runAt ?? FAR_FUTURE(), opts.maxAttempts ?? 25, opts.jobKey ?? null],
    );
    const id = rows[0]!.id;
    createdIds.push(id);
    return id;
  }

  async function setExhausted(id: string): Promise<void> {
    await pool.query(
      'UPDATE graphile_worker._private_jobs SET attempts = max_attempts, key = NULL WHERE id = $1',
      [id],
    );
  }

  async function setAttempts(id: string, attempts: number): Promise<void> {
    await pool.query('UPDATE graphile_worker._private_jobs SET attempts = $2 WHERE id = $1', [
      id,
      attempts,
    ]);
  }

  it('reaps an exhausted NULL-key location-poll job but spares the live keyed one', async () => {
    const zombieId = await addLocationPollJob({ maxAttempts: 1 });
    await setExhausted(zombieId);
    const keyedId = await addLocationPollJob({ jobKey: 'location-poll:zombie-reap-test' });

    await reapExhaustedLocationPollZombies();

    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM graphile_worker._private_jobs WHERE id = ANY($1::bigint[])',
      [[zombieId, keyedId]],
    );
    const surviving = rows.map((r) => r.id);
    expect(surviving).not.toContain(zombieId);
    expect(surviving).toContain(keyedId);
  });

  it('counts a runnable row as backlog but drops it once exhausted', async () => {
    // A due, unlocked row with retry budget remaining.
    const id = await addLocationPollJob({ maxAttempts: 5, runAt: new Date().toISOString() });

    // `countJobBacklog` is a global scalar and other suites churn the shared
    // queue concurrently, so bracket a single toggle of *this* row's attempts and
    // retry until one measurement pair lands uncontended. The delta is 1 only if
    // the row counts while runnable and is excluded once `attempts >= max_attempts`
    // — the behaviour under test. A wrong predicate never yields 1.
    await expect
      .poll(
        async () => {
          await setAttempts(id, 0); // runnable
          const withRunnable = await countJobBacklog();
          await setAttempts(id, 5); // exhausted (== max_attempts)
          const withExhausted = await countJobBacklog();
          return withRunnable - withExhausted;
        },
        { timeout: 15_000, interval: 100 },
      )
      .toBe(1);
  });
});
