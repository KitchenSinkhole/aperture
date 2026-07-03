## gauges.ts

**Purpose:** Sample the instantaneous metric gauges (not held in the registry) freshly on each scrape/snapshot.
**File:** `src/lib/metrics/gauges.ts`

---

Mix of DB counts, in-process counters, and process vitals. No `server-only` import — read both from the `/metrics` route (Phase 3) and the snapshot job (Phase 5, background worker). A rolling `monitorEventLoopDelay` monitor is started once at module load and reset on each sample.

### sampleGauges(): Promise<GaugeReadings>
Sample every gauge once (DB counts run concurrently; process vitals are synchronous). Returns:
- `trackedCharacters` — `count(ap_map_character_tracking)`.
- `visibleSystems` — `count(ap_map_system WHERE visible)`.
- `wsConnections` — live socket count (`wsConnectionCount()`).
- `openEsiBreakers` — `openBreakerCount()`.
- `jobBacklog` — runnable `graphile_worker._private_jobs` (unlocked, due, `attempts < max_attempts` so permanently-failed rows don't read as backlog). Degrades to `0` if the worker schema isn't migrated yet.
- `jobsAbandoned` — `ap_job_run` rows with `ended_at IS NULL` (worker died mid-job).
- `dbPoolTotal` / `dbPoolIdle` / `dbPoolWaiting` — `pool.totalCount` / `idleCount` / `waitingCount` (synchronous `pg.Pool` reads; pool-saturation signal).
- `processRssBytes` / `processHeapUsedBytes` / `processHeapTotalBytes` — `process.memoryUsage()`.
- `eventLoopLagMs` — mean event-loop delay since the previous sample.
- `tableRows` — `TableRowEstimate[]`, one entry per logical `ap_*` / `universe_*` table.

### countJobBacklog(): Promise<number>
Count runnable `graphile_worker._private_jobs` (`locked_at IS NULL AND run_at <= now() AND attempts < max_attempts`) — the `jobBacklog` reading. `attempts < max_attempts` keeps permanently-failed rows from reading as backlog. Degrades to `0` if the worker schema isn't migrated yet. Row counts come from `pg_class.reltuples` (planner estimate, no table scan); partition leaves are summed under their parent so the label set stays bounded to logical tables rather than growing one series per daily partition. Negative reltuples (never-analyzed) clamp to 0; a query error degrades to `[]`. Rendered as the labelled `db_table_rows{table}` gauge; not persisted to `ap_metric_snapshot` (dynamic table set — Prometheus-only).
