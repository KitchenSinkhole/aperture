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
- `jobBacklog` — runnable `graphile_worker._private_jobs` (unlocked, due). Degrades to `0` if the worker schema isn't migrated yet.
- `jobsAbandoned` — `ap_job_run` rows with `ended_at IS NULL` (worker died mid-job).
- `dbPoolTotal` / `dbPoolIdle` / `dbPoolWaiting` — `pool.totalCount` / `idleCount` / `waitingCount` (synchronous `pg.Pool` reads; pool-saturation signal).
- `processRssBytes` / `processHeapUsedBytes` / `processHeapTotalBytes` — `process.memoryUsage()`.
- `eventLoopLagMs` — mean event-loop delay since the previous sample.
