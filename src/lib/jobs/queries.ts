import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apJobRun } from '@/db/schema';

/**
 * Read-only helpers over `ap_job_run` for the operability sweep
 * (CLI `pnpm jobs:status`). All inserts/updates to `ap_job_run` happen in
 * `withInstrumentation.ts`; these are the readers.
 */

export type JobRun = typeof apJobRun.$inferSelect;

/** Most recent `ap_job_run` rows for a single task, newest first. */
export async function recentRuns(taskName: string, limit: number): Promise<JobRun[]> {
  return db
    .select()
    .from(apJobRun)
    .where(eq(apJobRun.name, taskName))
    .orderBy(desc(apJobRun.startedAt))
    .limit(limit);
}

export type JobSummary = {
  name: string;
  lastStartedAt: Date | null;
  lastEndedAt: Date | null;
  lastSuccess: boolean | null;
  lastErrorText: string | null;
  runCount: number;
  successCount: number;
  failCount: number;
  abandonedCount: number;
  avgDurationMs: number | null;
};

/**
 * Per-task summary of runs whose `started_at` is within `sinceMs` of now.
 * "abandoned" rows are those with `ended_at IS NULL` — a worker process that
 * died mid-handler. The 11.6 CLI surfaces non-zero counts as a yellow flag.
 */
export async function summary(taskName: string, sinceMs: number): Promise<JobSummary> {
  const sinceCutoff = sql`now() - make_interval(secs => ${Math.round(sinceMs / 1000)})`;

  const aggResult = await db.execute<{
    run_count: number;
    success_count: number;
    fail_count: number;
    abandoned_count: number;
    avg_duration_ms: number | null;
  }>(
    sql`SELECT
          count(*)::int AS run_count,
          count(*) FILTER (WHERE success IS TRUE)::int  AS success_count,
          count(*) FILTER (WHERE success IS FALSE)::int AS fail_count,
          count(*) FILTER (WHERE ended_at IS NULL)::int AS abandoned_count,
          (avg(extract(epoch from (ended_at - started_at)) * 1000)
             FILTER (WHERE ended_at IS NOT NULL))::float AS avg_duration_ms
        FROM ap_job_run
        WHERE name = ${taskName}
          AND started_at >= ${sinceCutoff}`,
  );
  const agg = aggResult.rows[0]!;

  const [last] = await db
    .select({
      startedAt: apJobRun.startedAt,
      endedAt: apJobRun.endedAt,
      success: apJobRun.success,
      errorText: apJobRun.errorText,
    })
    .from(apJobRun)
    .where(eq(apJobRun.name, taskName))
    .orderBy(desc(apJobRun.startedAt))
    .limit(1);

  return {
    name: taskName,
    lastStartedAt: last?.startedAt ?? null,
    lastEndedAt: last?.endedAt ?? null,
    lastSuccess: last?.success ?? null,
    lastErrorText: last?.errorText ?? null,
    runCount: agg.run_count,
    successCount: agg.success_count,
    failCount: agg.fail_count,
    abandonedCount: agg.abandoned_count,
    avgDurationMs: agg.avg_duration_ms,
  };
}

/**
 * The most recently *finished* run across all tasks — the worker's heartbeat.
 * `null` when no run has ever completed. The health probe treats a finished run
 * within `HEALTH_WORKER_STALE_MS` as proof the worker is alive (the
 * `character-cleanup` cron guarantees a regular tick).
 */
export async function latestFinishedRun(): Promise<{ name: string; endedAt: Date } | null> {
  const [row] = await db
    .select({ name: apJobRun.name, endedAt: apJobRun.endedAt })
    .from(apJobRun)
    .where(isNotNull(apJobRun.endedAt))
    .orderBy(desc(apJobRun.endedAt))
    .limit(1);
  return row?.endedAt ? { name: row.name, endedAt: row.endedAt } : null;
}

/** Distinct task names that have any rows in `ap_job_run`. */
export async function knownTaskNames(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ name: apJobRun.name })
    .from(apJobRun)
    .where(isNotNull(apJobRun.name));
  return rows.map((r) => r.name);
}
