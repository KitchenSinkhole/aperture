## registry.ts

**Purpose:** In-process registry of cumulative metrics (counters + histograms), the shared source the `/metrics` endpoint and the snapshot job both read.
**File:** `src/lib/metrics/registry.ts`

---

Singleton across HMR via `globalThis` (mirrors `bus.ts`); per-process, never persisted. No `server-only` import — reached from `esiCall`, which runs in the background worker. Gauges are **not** here (they're instantaneous — see `gauges.ts`).

Core metrics, pre-registered on construction so a snapshot always carries the full shape:
- Counter `esi_requests_total` — labels `{operationId, outcome}`.
- Histogram `esi_request_duration_ms` — label `{operationId}`, buckets `METRICS_ESI_LATENCY_BUCKETS_MS`.
- Histogram `route_plan_duration_ms` — no labels, buckets `METRICS_ROUTE_LATENCY_BUCKETS_MS`.

Phase 8 deepened-instrumentation metrics, also pre-registered (labels stay bounded — fixed task vocabulary / route templates / outcome enums, never per-map/character/url):
- Counter `map_events_total` — `{task}` (event kind).
- Counter `realtime_broadcasts_total` — `{task}`; Histogram `realtime_fanout_duration_ms` — no labels, buckets `METRICS_FANOUT_LATENCY_BUCKETS_MS`.
- Counter `pg_notify_received_total` — `{channel}` (collapsed channel-class, e.g. `map`).
- Counter `http_requests_total` — `{route, method, status}`; Histogram `http_request_duration_ms` — `{route}`, buckets `METRICS_HTTP_LATENCY_BUCKETS_MS`.
- Counter `job_runs_total` — `{task, outcome}`; Histogram `job_duration_ms` — `{task}`, buckets `METRICS_JOB_DURATION_BUCKETS_MS`.
- Counter `location_polls_total` — `{outcome}`.
- Counter `character_jumps_total` — no labels.
- Counter `error_log_events_total` — `{source}`.
- Counter `webhook_deliveries_total` — `{target, outcome}`.
- Counter `esi_token_refresh_total` — `{outcome}`.
- Counter `jwk_cache_refresh_total` — `{outcome}`.

### Exported constants
- `ESI_REQUESTS_TOTAL`, `ESI_REQUEST_DURATION_MS`, `ROUTE_PLAN_DURATION_MS` — Phase 2 metric names.
- `MAP_EVENTS_TOTAL`, `REALTIME_BROADCASTS_TOTAL`, `PG_NOTIFY_RECEIVED_TOTAL`, `HTTP_REQUESTS_TOTAL`, `JOB_RUNS_TOTAL`, `LOCATION_POLLS_TOTAL`, `CHARACTER_JUMPS_TOTAL`, `ERROR_LOG_EVENTS_TOTAL`, `WEBHOOK_DELIVERIES_TOTAL`, `ESI_TOKEN_REFRESH_TOTAL`, `JWK_CACHE_REFRESH_TOTAL`, `REALTIME_FANOUT_DURATION_MS`, `HTTP_REQUEST_DURATION_MS`, `JOB_DURATION_MS` — Phase 8 metric names.

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

### recordHttpRequest(route: string, method: string, status: string, durationMs: number): void
Tally one `http_requests_total{route,method,status}` and observe `http_request_duration_ms{route}`. Used by `httpInstrumentation.ts`.

### recordJobRun(task: string, outcome: JobOutcome, durationMs: number): void
Tally one `job_runs_total{task,outcome}` and observe `job_duration_ms{task}`. Used by `withInstrumentation.ts`.

### recordRealtimeBroadcast(task: string, durationMs: number): void
Tally one `realtime_broadcasts_total{task}` and observe `realtime_fanout_duration_ms` (no labels). Used by `bus.ts`.

### recordMapEvent(task: string): void
Tally one `map_events_total{task}`. Used by `commitMapEvent` (`core.ts`).

### recordLocationPoll(outcome: LocationPollOutcome): void
Tally one `location_polls_total{outcome}`. Used by `locationPoll.ts`.

### recordCharacterJump(): void
Tally one `character_jumps_total` (label-free). Used by `connectionMassLog.ts`.

### recordWebhookDelivery(outcome: WebhookOutcome): void
Tally one `webhook_deliveries_total{target='discord',outcome}`. Used by `dispatcher.ts`.

### recordTokenRefresh(outcome: TokenRefreshOutcome): void
Tally one `esi_token_refresh_total{outcome}`. Used by `eve-provider.ts`.

### recordJwkRefresh(outcome: JwkRefreshOutcome): void
Tally one `jwk_cache_refresh_total{outcome}`. Used by `jwks.ts` (per genuine remote JWKS fetch).
