import { bigint, bigserial, doublePrecision, integer, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core';

// Bounded operational-metrics time-series. One row per snapshot tick (the
// `metrics-snapshot` cron job samples the in-process registry + gauges every
// `METRICS_SNAPSHOT_CRON`). `/metrics` (Phase 3) is point-in-time; this table is
// the history the admin metrics page (Phase 5) graphs, with zero external infra.
//
// PARTITIONED DAILY by `captured_at` via pg_partman — Drizzle can't emit
// partitioned DDL, so the migration (0046_metric_snapshot.sql) hand-writes the
// `PARTITION BY RANGE` table, the `partman.create_parent` call, and the 30-day
// retention `part_config` row. This Drizzle definition exists only for type
// inference; the partition key must be part of the PK, hence the composite
// `(id, captured_at)`. Retention is reaped by the existing partition-maintenance
// job — no dedicated reap task.
//
// The `*_total` / `*_sum_ms` / `*_count` columns are CUMULATIVE registry values
// (monotonic per process). The registry lives in-process and is never persisted,
// so a process restart resets them to zero; the read path (`deriveSeries` in
// `src/lib/metrics/history.ts`) treats a value that drops below its predecessor
// as a reset. Gauge columns are instantaneous samples.
export const apMetricSnapshot = pgTable(
  'ap_metric_snapshot',
  {
    id: bigserial('id', { mode: 'number' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    // Cumulative counter rollups (aggregated across the registry's label-sets).
    esiRequestsTotal: bigint('esi_requests_total', { mode: 'number' }).notNull(),
    esiRequestsFailed: bigint('esi_requests_failed', { mode: 'number' }).notNull(),
    esiDurationSumMs: doublePrecision('esi_duration_sum_ms').notNull(),
    esiDurationCount: bigint('esi_duration_count', { mode: 'number' }).notNull(),
    routePlanDurationSumMs: doublePrecision('route_plan_duration_sum_ms').notNull(),
    routePlanDurationCount: bigint('route_plan_duration_count', { mode: 'number' }).notNull(),
    // Instantaneous gauges.
    trackedCharacters: integer('tracked_characters').notNull(),
    visibleSystems: integer('visible_systems').notNull(),
    wsConnections: integer('ws_connections').notNull(),
    esiBreakersOpen: integer('esi_breakers_open').notNull(),
    jobBacklog: integer('job_backlog').notNull(),
    jobsAbandoned: integer('jobs_abandoned').notNull(),
    processRssBytes: bigint('process_rss_bytes', { mode: 'number' }).notNull(),
    processHeapUsedBytes: bigint('process_heap_used_bytes', { mode: 'number' }).notNull(),
    eventLoopLagMs: doublePrecision('event_loop_lag_ms').notNull(),
  },
  (t) => [primaryKey({ columns: [t.id, t.capturedAt] })],
);
