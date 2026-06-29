## history.ts

**Purpose:** Read side of the metrics history — turns cumulative `ap_metric_snapshot` rollups into the per-interval rates/averages the admin metrics page graphs, plus a per-bucket job-success ratio from `ap_job_run`.
**File:** `src/lib/metrics/history.ts`

---

### deriveSeries(rows: ApMetricSnapshot[]): MetricHistoryPoint[]
Pure (no DB). Walks chronologically-ordered snapshot rows; each adjacent pair yields one point covering the interval ending at the later row's `capturedAt` (so N rows → N-1 points).

- Counter deltas use a **reset guard**: if a cumulative value drops below its predecessor (process restarted → registry reset to zero), the current value is taken as the post-reset increment.
- Emits: `esiRequestRate` (req/min), `esiFailurePct` (% non-success, null when no requests), `esiAvgLatencyMs` / `routeAvgLatencyMs` (Δsum/Δcount, null when Δcount = 0); gauges pass through (RSS/heap converted bytes→MB).

### loadMetricHistory(range: MetricRange): Promise<MetricHistory>
Bucketed read for one window. Per `range` picks a window length + `date_bin` bucket width (`1h`→1m, `24h`→5m, `7d`→1h, `30d`→6h) so the point count stays bounded. Takes the **last** snapshot per bucket via `DISTINCT ON (bucket) … ORDER BY bucket, captured_at DESC` — that row carries both the cumulative counters (for deltas) and the instantaneous gauges — then feeds `deriveSeries`. Separately groups `ap_job_run` (finished runs) into the same buckets for `successPct`/`runs`. Returns `{ range, fromMs, toMs, points, jobRuns }`, where `fromMs`/`toMs` are the window bounds (epoch ms) — the authoritative fixed X-axis domain for the page, independent of how much data exists in the window.

### Notes
- Bucketing/grouping is done in SQL (`date_bin`, PG14+) rather than fetching every raw row, so a 30-day window stays ~120 points instead of ~43k.
- Raw `db.execute` rows arrive with int8 columns as strings; `toSnapshot` coerces via `Number`.
