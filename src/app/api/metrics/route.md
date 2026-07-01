## route.ts (api/metrics)

**Purpose:** Prometheus scrape endpoint — exports the metrics registry + gauges in text exposition format.
**File:** `src/app/api/metrics/route.ts`

---

### GET /api/metrics
Renders `renderPrometheus(metrics.snapshot(), await sampleGauges())` (`src/lib/metrics/prometheus.ts`) as `text/plain; version=0.0.4`. Counters/histograms come from the in-process registry; gauges are sampled fresh per request.

Gating:
- `404` when `env.METRICS_ENABLED` is false (default) — endpoint is opt-in.
- `401` (with `WWW-Authenticate: Bearer`) when the supplied token doesn't match `env.METRICS_TOKEN`. Token is read from an `Authorization: Bearer …` header or a `?token=` query param; comparison is constant-time (`crypto.timingSafeEqual`), and an empty configured token matches nothing.

- `runtime = 'nodejs'` — gauges read the DB pool and `process.memoryUsage()`.
- `dynamic = 'force-dynamic'` — never statically cached.

Exposes Ionis's six (ESI rate/latency/failure via `esi_requests_total` outcome labels + `esi_request_duration_ms`, `tracked_characters`, `visible_systems`, `route_plan_duration_ms`) alongside the infra gauges.
