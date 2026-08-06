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
  await reapExhaustedLocationPollZombies();
  await closeOrphanedJobRuns();
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
 * Purge permanently-failed NULL-key `location-poll` zombies on boot. When an
 * expected-outage tick used to re-enqueue-and-throw, `jobKeyMode:'replace'`
 * nulled the running row's `key` and the throw walked its `attempts` to
 * `max_attempts` — leaving an exhausted, unkeyed row graphile never runs again.
 * `rearmLocationPollLoop` only matches keyed rows, so these accumulate forever.
 * They are duplicates of the one live keyed job per character, so they are
 * deleted, not revived. The source fix (`locationPoll.ts`) stops new ones being
 * created; this clears any legacy backlog and is cheap defense-in-depth.
 */
export async function reapExhaustedLocationPollZombies(): Promise<void> {
  const res = await pool.query(
    `DELETE FROM graphile_worker._private_jobs j
       USING graphile_worker._private_tasks t
      WHERE j.task_id = t.id
        AND t.identifier = 'location-poll'
        AND j.key IS NULL
        AND j.locked_at IS NULL
        AND j.attempts >= j.max_attempts`,
  );
  if (res.rowCount && res.rowCount > 0) {
    jobLog.info('Reaped exhausted NULL-key location-poll job(s)', { count: res.rowCount });
  }
}

/**
 * Close out `ap_job_run` rows left un-ended on boot. `withInstrumentation`
 * finalises its row from a `catch`, so a row with `ended_at IS NULL` and no
 * worker alive to finish it means the process was killed outright — SIGKILL on
 * a container recreate, a host OOM kill, a V8 abort. Nothing else ever ends
 * those rows, and the `job_abandoned` alert counts exactly this shape, so a
 * single killed handler otherwise leaves the instance alerting forever with no
 * path back to healthy.
 *
 * Boot is the safe moment: no handler of this process is in flight yet. A run
 * still executing in an overlapping instance is closed here but re-finalised
 * correctly by its own handler's terminal `UPDATE`, which sets `ended_at`,
 * `success` and `notes` unconditionally.
 */
async function closeOrphanedJobRuns(): Promise<void> {
  const res = await pool.query(
    `UPDATE ap_job_run
        SET ended_at = now(),
            success = false,
            error_text = 'Worker process exited before the handler recorded an end.'
      WHERE ended_at IS NULL`,
  );
  if (res.rowCount && res.rowCount > 0) {
    jobLog.warn('Closed orphaned job run(s) left by a killed worker', { count: res.rowCount });
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
