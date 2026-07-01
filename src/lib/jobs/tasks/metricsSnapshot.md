## metricsSnapshot.ts

**Purpose:** Cron that samples the in-process metric registry + instantaneous gauges into one `ap_metric_snapshot` row, building the history the admin metrics page graphs (`/metrics` itself is point-in-time).
**File:** `src/lib/jobs/tasks/metricsSnapshot.ts`

---

### metricsSnapshot: JobModule
- `name`: `'metrics-snapshot'`
- `cron`: `apertureConfig.METRICS_SNAPSHOT_CRON` (`*/1 * * * *`).
- `run`: `withInstrumentation('metrics-snapshot', snapshotMetrics)`.

### snapshotMetrics(): { capturedAt }
Reads `metrics.snapshot()` ([[registry]]) and `await sampleGauges()` ([[gauges]]), rolls the counters/histograms up, and inserts one row with `captured_at = now()`. Returns the ISO `capturedAt` (recorded in `ap_job_run.notes`).

**Rollups:**
- `esiRequestsTotal` = Σ `esi_requests_total` across label-sets; `esiRequestsFailed` = Σ where `outcome != 'success'`.
- `esiDurationSumMs` / `esiDurationCount` = aggregated `esi_request_duration_ms` histogram sum/count (across `operationId` series).
- `routePlanDurationSumMs` / `routePlanDurationCount` = aggregated `route_plan_duration_ms` histogram sum/count.
- Gauge columns copied straight from `GaugeReadings`.

### Notes
- The counter/histogram columns are stored **cumulatively** (raw registry values, monotonic per process). Rates and averages are derived from inter-row deltas on read ([[history]]); a process restart resets the registry to zero and the read path treats the drop as a reset.
- The worker shares the web server's process (`server.ts` boots graphile-worker after `server.listen`), so the registry sampled here is the same singleton the web request handlers and the location-poll worker write to.
- Does **not** import `server-only` — runs in the bare-`tsx` worker (CLAUDE.md runner rule).
- Retention (30 days) is enforced by the existing `partition-maintenance` job via pg_partman; no dedicated reap task.
