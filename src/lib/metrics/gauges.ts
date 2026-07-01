import { monitorEventLoopDelay } from 'node:perf_hooks';
import { eq, isNull, sql } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { apJobRun, apMapCharacterTracking, apMapSystem } from '@/db/schema';
import { openBreakerCount } from '@/lib/esi/breaker';
import { wsConnectionCount } from '@/lib/realtime/wsConnections';
import type { GaugeReadings } from '@/types';

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
  const [trackedCharacters, visibleSystems, jobQueue] = await Promise.all([
    countTrackedCharacters(),
    countVisibleSystems(),
    sampleJobQueue(),
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
  };
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
 * Queue health: `backlog` = runnable graphile-worker jobs waiting for a worker;
 * `abandoned` = `ap_job_run` rows whose handler never recorded an end (a worker
 * that died mid-job). The graphile-worker private table may not exist before the
 * worker has migrated, so a missing-table error degrades backlog to 0 rather
 * than failing the whole scrape.
 */
async function sampleJobQueue(): Promise<{ backlog: number; abandoned: number }> {
  const [backlog, abandoned] = await Promise.all([countJobBacklog(), countAbandonedRuns()]);
  return { backlog, abandoned };
}

async function countJobBacklog(): Promise<number> {
  try {
    const res = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n
            FROM graphile_worker._private_jobs
           WHERE locked_at IS NULL AND run_at <= now()`,
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
