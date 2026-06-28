import {
  parseCronItems,
  run as graphileRun,
  runMigrations,
  runOnce as graphileRunOnce,
  type RunnerOptions,
  type Runner,
} from 'graphile-worker';
import { apertureConfig } from '../../../aperture.config';
import { pool } from '@/db/client';
import { getLogger } from '@/lib/log/logger';
import { buildCronItems, buildTaskList, type JobModule } from './registry';

const jobLog = getLogger('job');

/**
 * The graphile-worker runtime. Single Node process, shares the
 * app's pg.Pool, no Redis, no separate worker container.
 *
 * Boot order:
 *   1. `startWorker()` calls graphile-worker's own `runMigrations` to create /
 *      upgrade the `graphile_worker` schema.
 *   2. Then `run({ pgPool, taskList, parsedCronItems, ... })` returns the
 *      long-lived `Runner` which holds the worker pool + cron + LISTEN side.
 *
 * `noHandleSignals: true` is set because `server.ts` owns process-level
 * SIGTERM/SIGINT and explicitly calls `stopWorker` so we don't race with
 * graphile-worker's own signal handlers (which would also shut down our HTTP
 * server-attached resources independently).
 */

let activeRunner: Runner | null = null;

function baseOptions(extra: readonly JobModule[]): RunnerOptions {
  return {
    pgPool: pool,
    concurrency: apertureConfig.JOB_WORKER_CONCURRENCY,
    pollInterval: apertureConfig.JOB_POLL_INTERVAL_MS,
    noHandleSignals: true,
    taskList: buildTaskList(extra),
    parsedCronItems: parseCronItems(buildCronItems(extra) as Parameters<typeof parseCronItems>[0]),
  };
}

/**
 * Boot the worker. Idempotent within a process — repeated calls return the
 * existing Runner. `extraModules` lets tests inject one-off tasks (the
 * standard registry modules from `registry.ts` are always included).
 */
export async function startWorker(extraModules: readonly JobModule[] = []): Promise<Runner> {
  if (activeRunner) return activeRunner;
  const opts = baseOptions(extraModules);
  await runMigrations(opts);
  await rearmLocationPollLoop();
  activeRunner = await graphileRun(opts);
  return activeRunner;
}

/**
 * Re-arm the location-poll loop on boot, before the pool starts. Two failure
 * modes leave a character silently untracked with no other recovery path:
 *
 *   1. **Orphaned lock** — after an unclean shutdown (crash / SIGKILL / power
 *      loss, or in dev `tsx watch` hard-killing the child on Windows) the row
 *      stays `locked_at IS NOT NULL`. graphile-worker only reclaims it after a
 *      hardcoded 4h (`resetLockedAt`, not configurable in 0.16); until then even
 *      an immediate restart won't touch the locked row.
 *   2. **Exhausted retries** — a job that burned all `max_attempts` is unlocked
 *      and permanently failed. graphile never runs it again, and nothing
 *      re-enqueues (the per-map seed marker already exists), so the loop is dead
 *      for good. The client's 401 handling makes this far less likely, but any
 *      other persistent error could still walk a loop to exhaustion.
 *
 * Both are revived here: clear the lock, reset the attempt budget, and pull
 * `run_at` to now. Scoped to `location-poll` only — it's idempotent (the jump
 * fold dedupes; the re-enqueue uses `jobKey: 'replace'`), so the worst case
 * under an overlapping deploy is one character double-polling for a single tick.
 * We deliberately do NOT blanket-reset every task: a long, non-idempotent job
 * (e.g. `sdeIngest`) legitimately held by a still-draining instance must not be
 * yanked out from under it, which is why a worker-scoped `force_unlock_workers`
 * is wrong here. The lock columns mirror graphile-worker's own `resetLockedAt`.
 */
async function rearmLocationPollLoop(): Promise<void> {
  const res = await pool.query(
    `UPDATE graphile_worker._private_jobs
        SET locked_at = NULL,
            locked_by = NULL,
            attempts = 0,
            last_error = NULL,
            run_at = GREATEST(run_at, now())
      WHERE key LIKE 'location-poll:%'
        AND (locked_at IS NOT NULL OR attempts >= max_attempts)`,
  );
  if (res.rowCount && res.rowCount > 0) {
    jobLog.info('Re-armed stalled location-poll job(s) (orphaned lock or exhausted retries)', {
      count: res.rowCount,
    });
  }
}

/**
 * Stop the running worker (graceful shutdown of the worker pool + cron + LISTEN
 * client). Safe to call when no worker is running.
 */
export async function stopWorker(): Promise<void> {
  if (!activeRunner) return;
  const runner = activeRunner;
  activeRunner = null;
  await runner.stop();
}

/**
 * Run every due cron job once and exit. Used by `pnpm worker:once` (CI / cron
 * smoke). Does NOT install LISTEN or start a long-lived worker pool. Migrations
 * run first so a fresh DB works.
 */
export async function runWorkerOnce(extraModules: readonly JobModule[] = []): Promise<void> {
  const opts = baseOptions(extraModules);
  await runMigrations(opts);
  await graphileRunOnce(opts);
}

/** True iff `startWorker` has booted (and `stopWorker` has not yet been called). Exposed for tests/health. */
export function isWorkerRunning(): boolean {
  return activeRunner !== null;
}
