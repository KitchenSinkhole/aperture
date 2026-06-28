## metric_snapshot.ts

**Purpose:** Bounded operational-metrics time-series (`ap_metric_snapshot`); one row per snapshot tick, the history the admin metrics page graphs.
**File:** `src/db/schema/ap/metric_snapshot.ts`

---

### apMetricSnapshot
Drizzle table `ap_metric_snapshot`. Daily-partitioned by `captured_at` via pg_partman (DDL in `0046_metric_snapshot.sql`; this definition is for type inference only).

**Columns:**
- `id` (bigserial) — PK part 1.
- `capturedAt` (`captured_at`, timestamptz) — snapshot instant. PK part 2 and partition key.
- Cumulative counter rollups (monotonic per process; reset to zero on restart):
  - `esiRequestsTotal` (`esi_requests_total`, bigint) — Σ `esi_requests_total` across label-sets.
  - `esiRequestsFailed` (`esi_requests_failed`, bigint) — Σ where `outcome != 'success'`.
  - `esiDurationSumMs` / `esiDurationCount` (double / bigint) — `esi_request_duration_ms` histogram sum/count.
  - `routePlanDurationSumMs` / `routePlanDurationCount` (double / bigint) — `route_plan_duration_ms` histogram sum/count.
- Instantaneous gauges (from `GaugeReadings`):
  - `trackedCharacters`, `visibleSystems`, `wsConnections`, `esiBreakersOpen`, `jobBacklog`, `jobsAbandoned` (integer).
  - `processRssBytes`, `processHeapUsedBytes` (bigint), `eventLoopLagMs` (double).

**Notes:** Written by the `metrics-snapshot` cron job ([[metricsSnapshot]]) sampling `metrics.snapshot()` + `sampleGauges()`. Cumulative columns are raw — rates/averages are derived from inter-row deltas on read by `deriveSeries` ([[history]]), which guards against the restart reset. Retention is 30 days, enforced by pg_partman (`part_config` set in the migration) and the existing `partition-maintenance` job — rolloff is `DETACH/DROP PARTITION`, not `DELETE` (no dedicated reap task). Empty until the first snapshot tick.
