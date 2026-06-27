## registry.ts

**Purpose:** In-process registry of cumulative metrics (counters + histograms), the shared source the `/metrics` endpoint and the snapshot job both read.
**File:** `src/lib/metrics/registry.ts`

---

Singleton across HMR via `globalThis` (mirrors `bus.ts`); per-process, never persisted. No `server-only` import — reached from `esiCall`, which runs in the background worker. Gauges are **not** here (they're instantaneous — see `gauges.ts`).

Core metrics, pre-registered on construction so a snapshot always carries the full shape:
- Counter `esi_requests_total` — labels `{operationId, outcome}`.
- Histogram `esi_request_duration_ms` — label `{operationId}`, buckets `METRICS_ESI_LATENCY_BUCKETS_MS`.
- Histogram `route_plan_duration_ms` — no labels, buckets `METRICS_ROUTE_LATENCY_BUCKETS_MS`.

### Exported constants
- `ESI_REQUESTS_TOTAL`, `ESI_REQUEST_DURATION_MS`, `ROUTE_PLAN_DURATION_MS` — metric names.

### metrics
The singleton `MetricsRegistry`. Methods:
- `incrementCounter(name, labels?, by=1)` — add to a counter series (keyed by sorted labels). No-op for an unknown name.
- `observeHistogram(name, labels, value)` — record one observation; buckets are cumulative `le` counts.
- `snapshot(): MetricsSnapshot` — immutable copy of all counters/histograms.
- `reset()` — **test-only**; clears series and re-registers core metrics.

### recordEsiRequest(operationId: string, outcome: EsiMetricOutcome, durationMs: number | null): void
Tally one ESI request and (when `durationMs` is non-null) observe its latency. Callers pass `null` for `breaker_open` / `token_error` — those short-circuit before the network, so timing them would skew the histogram toward zero.

### recordRoutePlan(durationMs: number): void
Observe one `route_plan_duration_ms` sample.
