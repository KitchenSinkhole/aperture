import { monitorEventLoopDelay } from 'node:perf_hooks';
import { eq, isNull, sql } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { apJobRun, apMapCharacterTracking, apMapSystem } from '@/db/schema';
import { openBreakerCount } from '@/lib/esi/breaker';
import { wsConnectionCount } from '@/lib/realtime/wsConnections';
import type { GaugeReadings, TableRowEstimate } from '@/types';

/**
 * Instantaneous metric gauges — sampled fresh on every scrape/snapshot rather
 * than accumulated in the registry. Mix of DB counts (tracked characters,
 * visible systems, job queue), in-process counters (WS connections, open ESI
 * breakers), and process vitals (memory, event-loop lag).
 *
 * No `import 'server-only'`: read both from the `/metrics` route (Phase 3) and
 * the snapshot job (Phase 5), the latter running in the background worker.
 */

// Started once at module load: a rolling event-loop-delay monitor. `sampleGauges`
// reads its mean and resets, so each sample reflects lag since the prior scrape.
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

/** Sample every gauge once. DB counts run concurrently; process vitals are sync. */
export async function sampleGauges(): Promise<GaugeReadings> {
  const [trackedCharacters, visibleSystems, jobQueue, tableRows] = await Promise.all([
    countTrackedCharacters(),
    countVisibleSystems(),
    sampleJobQueue(),
    sampleTableRows(),
  ]);

  const mem = process.memoryUsage();
  const lagMeanMs = loopDelay.mean / 1e6; // nanoseconds → ms
  loopDelay.reset();

  return {
    trackedCharacters,
    visibleSystems,
    wsConnections: wsConnectionCount(),
    openEsiBreakers: openBreakerCount(),
    jobBacklog: jobQueue.backlog,
    jobsAbandoned: jobQueue.abandoned,
    // pg.Pool exposes these synchronously; pool saturation is a classic silent
    // killer and a free read.
    dbPoolTotal: pool.totalCount,
    dbPoolIdle: pool.idleCount,
    dbPoolWaiting: pool.waitingCount,
    processRssBytes: mem.rss,
    processHeapUsedBytes: mem.heapUsed,
    processHeapTotalBytes: mem.heapTotal,
    eventLoopLagMs: Number.isFinite(lagMeanMs) ? lagMeanMs : 0,
    tableRows,
  };
}

/**
 * Estimated rows per logical table from `pg_class.reltuples` — the planner's
 * estimate, maintained by autovacuum/ANALYZE, so this never scans a table (safe
 * to sample on every scrape). Partition leaves are summed under their parent so
 * the label set stays bounded to the ~dozens of `ap_*` / `universe_*` tables
 * instead of growing a series per daily partition. Never-analyzed relations
 * report `reltuples = -1` (PG14+); clamp negatives to 0. A query failure
 * degrades to an empty set rather than sinking the whole scrape.
 */
async function sampleTableRows(): Promise<TableRowEstimate[]> {
  try {
    const res = await db.execute<{ table_name: string; rows: string }>(
      sql`SELECT COALESCE(p.relname, c.relname) AS table_name,
                 sum(GREATEST(c.reltuples, 0))::bigint AS rows
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
            LEFT JOIN pg_class p ON p.oid = i.inhparent
           WHERE c.relkind = 'r'
             AND n.nspname = 'public'
             AND COALESCE(p.relname, c.relname) ~ '^(ap|universe)_'
           GROUP BY 1
           ORDER BY 1`,
    );
    return res.rows.map((r) => ({ table: r.table_name, rows: Number(r.rows) }));
  } catch {
    return [];
  }
}

async function countTrackedCharacters(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apMapCharacterTracking);
  return row?.n ?? 0;
}

async function countVisibleSystems(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apMapSystem)
    .where(eq(apMapSystem.visible, true));
  return row?.n ?? 0;
}

/**
 * Queue health: `backlog` = runnable graphile-worker jobs waiting for a worker
 * (unlocked, due, with retry budget remaining — `attempts < max_attempts`
 * excludes permanently-failed rows so a dead job never reads as backlog);
 * `abandoned` = `ap_job_run` rows whose handler never recorded an end (a worker
 * that died mid-job). The graphile-worker private table may not exist before the
 * worker has migrated, so a missing-table error degrades backlog to 0 rather
 * than failing the whole scrape.
 */
async function sampleJobQueue(): Promise<{ backlog: number; abandoned: number }> {
  const [backlog, abandoned] = await Promise.all([countJobBacklog(), countAbandonedRuns()]);
  return { backlog, abandoned };
}

export async function countJobBacklog(): Promise<number> {
  try {
    const res = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n
            FROM graphile_worker._private_jobs
           WHERE locked_at IS NULL AND run_at <= now() AND attempts < max_attempts`,
    );
    return res.rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

async function countAbandonedRuns(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apJobRun)
    .where(isNull(apJobRun.endedAt));
  return row?.n ?? 0;
}
