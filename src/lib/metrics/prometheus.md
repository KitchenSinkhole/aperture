## prometheus.ts

**Purpose:** Render the metrics registry snapshot + instantaneous gauges into Prometheus text exposition format (v0.0.4).
**File:** `src/lib/metrics/prometheus.ts`

---

Pure string assembly, no `server-only` import, no Prometheus client lib — the registry already holds cumulative `le` bucket counts in the shape the format needs. Only consumer is `/api/metrics`; Prometheus owns retention so nothing is persisted.

Gauge names/help live in a module-private `GAUGE_METRICS` table that maps each flat `GaugeReadings` key to a conventionally-named Prometheus gauge (`*_bytes`, `*_ms`, etc.): `tracked_characters`, `visible_systems`, `ws_connections`, `esi_breakers_open`, `job_backlog`, `jobs_abandoned`, `db_pool_total_connections`, `db_pool_idle_connections`, `db_pool_waiting_connections`, `process_resident_memory_bytes`, `process_heap_used_bytes`, `process_heap_total_bytes`, `event_loop_lag_ms`. The db-pool gauges are three flat (label-free) gauges rather than one labelled `db_pool_connections{state}` — the gauge layer is intentionally label-free, and three flat gauges are a standard Prometheus pattern needing no formatter change.

### renderPrometheus(snapshot: MetricsSnapshot, gauges: GaugeReadings): string
Emit, in order: each counter (`# HELP`/`# TYPE counter` + one line per label-set), each histogram (`_bucket{…,le="…"}` per finite bucket, a `+Inf` bucket equal to the total count, plus `_sum` and `_count`), then each gauge. Label values escape `\`, newline, and `"`; help text escapes `\` and newline. Non-finite sample values collapse to `0`. Returns the full body with a trailing newline.
