import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type {
  ApMetricSnapshot,
  JobSuccessPoint,
  MetricHistory,
  MetricHistoryPoint,
  MetricRange,
} from '@/types';

/**
 * Read side of the metrics history (Phase 5). Turns the cumulative
 * `ap_metric_snapshot` rollups into the per-interval rates/averages the admin
 * page graphs, plus a per-bucket job-success ratio sourced from `ap_job_run`.
 *
 * The cumulative counters are raw registry values that reset to zero whenever the
 * process restarts (the registry is in-process, never persisted), so the delta
 * helper treats a value that drops below its predecessor as a reset.
 *
 * No `import 'server-only'`: `deriveSeries` is exercised by a pure unit test.
 */

/** Window length + SQL `date_bin` bucket width per selectable range. */
const RANGE_CONFIG: Record<MetricRange, { windowMs: number; bucket: string }> = {
  '1h': { windowMs: 60 * 60 * 1000, bucket: '1 minute' },
  '24h': { windowMs: 24 * 60 * 60 * 1000, bucket: '5 minutes' },
  '7d': { windowMs: 7 * 24 * 60 * 60 * 1000, bucket: '1 hour' },
  '30d': { windowMs: 30 * 24 * 60 * 60 * 1000, bucket: '6 hours' },
};

const BYTES_PER_MB = 1024 * 1024;

/**
 * Increment of a cumulative counter from `prev` to `curr`. A drop means the
 * process restarted (registry reset to zero), so `curr` is itself the post-reset
 * increment rather than a negative delta.
 */
function delta(curr: number, prev: number): number {
  return curr >= prev ? curr - prev : curr;
}

/**
 * Derive per-interval rates/averages + pass-through gauges from chronologically
 * ordered snapshot rows. Pure (no DB) — each point covers the interval ending at
 * its row's `captured_at`, so N rows yield N-1 points.
 */
export function deriveSeries(rows: ApMetricSnapshot[]): MetricHistoryPoint[] {
  const points: MetricHistoryPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const curr = rows[i]!;
    const dtMin = (curr.capturedAt.getTime() - prev.capturedAt.getTime()) / 60_000;

    const dReq = delta(curr.esiRequestsTotal, prev.esiRequestsTotal);
    const dFail = delta(curr.esiRequestsFailed, prev.esiRequestsFailed);
    const dEsiSum = delta(curr.esiDurationSumMs, prev.esiDurationSumMs);
    const dEsiCount = delta(curr.esiDurationCount, prev.esiDurationCount);
    const dRouteSum = delta(curr.routePlanDurationSumMs, prev.routePlanDurationSumMs);
    const dRouteCount = delta(curr.routePlanDurationCount, prev.routePlanDurationCount);

    points.push({
      t: curr.capturedAt.getTime(),
      esiRequestRate: dtMin > 0 ? dReq / dtMin : null,
      esiFailurePct: dReq > 0 ? (dFail / dReq) * 100 : null,
      esiAvgLatencyMs: dEsiCount > 0 ? dEsiSum / dEsiCount : null,
      routeAvgLatencyMs: dRouteCount > 0 ? dRouteSum / dRouteCount : null,
      trackedCharacters: curr.trackedCharacters,
      visibleSystems: curr.visibleSystems,
      wsConnections: curr.wsConnections,
      esiBreakersOpen: curr.esiBreakersOpen,
      jobBacklog: curr.jobBacklog,
      jobsAbandoned: curr.jobsAbandoned,
      processRssMb: curr.processRssBytes / BYTES_PER_MB,
      processHeapUsedMb: curr.processHeapUsedBytes / BYTES_PER_MB,
      eventLoopLagMs: curr.eventLoopLagMs,
    });
  }
  return points;
}

type RawSnapshotRow = Record<string, unknown>;

function num(v: unknown): number {
  return Number(v);
}

/** Map a raw `db.execute` row (int8 columns arrive as strings) into a typed snapshot. */
function toSnapshot(r: RawSnapshotRow): ApMetricSnapshot {
  return {
    id: num(r.id),
    capturedAt: new Date(r.captured_at as string | Date),
    esiRequestsTotal: num(r.esi_requests_total),
    esiRequestsFailed: num(r.esi_requests_failed),
    esiDurationSumMs: num(r.esi_duration_sum_ms),
    esiDurationCount: num(r.esi_duration_count),
    routePlanDurationSumMs: num(r.route_plan_duration_sum_ms),
    routePlanDurationCount: num(r.route_plan_duration_count),
    trackedCharacters: num(r.tracked_characters),
    visibleSystems: num(r.visible_systems),
    wsConnections: num(r.ws_connections),
    esiBreakersOpen: num(r.esi_breakers_open),
    jobBacklog: num(r.job_backlog),
    jobsAbandoned: num(r.jobs_abandoned),
    processRssBytes: num(r.process_rss_bytes),
    processHeapUsedBytes: num(r.process_heap_used_bytes),
    eventLoopLagMs: num(r.event_loop_lag_ms),
  };
}

/**
 * Load the bucketed, derived history for `range`. Bucketing happens in SQL
 * (`date_bin`, one row per bucket via `DISTINCT ON`) so the point count stays
 * bounded regardless of the snapshot cadence; the last snapshot in each bucket
 * carries both the cumulative counters (for deltas) and the instantaneous gauges.
 */
export async function loadMetricHistory(range: MetricRange): Promise<MetricHistory> {
  const { windowMs, bucket } = RANGE_CONFIG[range];
  const toMs = Date.now();
  const windowStart = new Date(toMs - windowMs);

  const snapRes = await db.execute<RawSnapshotRow>(sql`
    SELECT DISTINCT ON (bucket)
      id, captured_at,
      esi_requests_total, esi_requests_failed,
      esi_duration_sum_ms, esi_duration_count,
      route_plan_duration_sum_ms, route_plan_duration_count,
      tracked_characters, visible_systems, ws_connections, esi_breakers_open,
      job_backlog, jobs_abandoned,
      process_rss_bytes, process_heap_used_bytes, event_loop_lag_ms
    FROM (
      SELECT *, date_bin(${bucket}::interval, captured_at, timestamptz 'epoch') AS bucket
      FROM ap_metric_snapshot
      WHERE captured_at >= ${windowStart}
    ) s
    ORDER BY bucket, captured_at DESC
  `);

  const rows = snapRes.rows
    .map(toSnapshot)
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

  const jobRes = await db.execute<RawSnapshotRow>(sql`
    SELECT
      date_bin(${bucket}::interval, ended_at, timestamptz 'epoch') AS bucket,
      sum(weight)::int AS runs,
      sum(CASE WHEN success THEN weight ELSE 0 END)::int AS succeeded
    FROM ap_job_run
    WHERE ended_at IS NOT NULL AND ended_at >= ${windowStart}
    GROUP BY bucket
    ORDER BY bucket
  `);

  const jobRuns: JobSuccessPoint[] = jobRes.rows.map((r) => {
    const runs = num(r.runs);
    const succeeded = num(r.succeeded);
    return {
      t: new Date(r.bucket as string | Date).getTime(),
      runs,
      successPct: runs > 0 ? (succeeded / runs) * 100 : null,
    };
  });

  return { range, fromMs: windowStart.getTime(), toMs, points: deriveSeries(rows), jobRuns };
}
