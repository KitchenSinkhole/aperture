# Observability Phase 8 — Deepen Instrumentation Coverage

> **STATUS: SHIPPED.** All five tiers landed. New config buckets + outcome types + 14 metric
> series registered in `src/lib/metrics/registry.ts`; `withApiMetrics` wraps 38 `route.ts`
> handlers; emitters in `core.ts` / `bus.ts` / `withInstrumentation.ts` / `locationPoll.ts` /
> `connectionMassLog.ts` / `logger.ts` / `gauges.ts` / `prometheus.ts` / `dispatcher.ts` /
> `eve-provider.ts` / `jwks.ts`. Unit tests extended (Tier 1 `map_events_total`, Tier 2
> `http_request_duration_ms`, Tier 3 `job_runs_total`). `pnpm lint`/`typecheck`/`build` green;
> 407 unit tests pass.
>
> **Deviation recorded (per CLAUDE.md):** the per-route `route.md` companions were **not** edited.
> Wrapping a handler in `withApiMetrics` does not change its documented HTTP contract
> (method / path / body / access / response) — the metrics emission is a cross-cutting concern,
> not part of the route interface. This follows the established convention that a companion `.md`
> describes the current interface and needs no edit when the interface is unchanged. All other
> touched modules' companions were updated in the same operation.

## Context

Phases 2–3 instrumented only the **ESI egress** (`esi_requests_total`, `esi_request_duration_ms`), **route calc** (`route_plan_duration_ms`), and infra gauges. The realtime/mutation core, Aperture's own HTTP surface, per-task job flow, integrations, and auth are still dark — which is exactly the layer that broke in the motivating outage ("is *Aperture itself* serving users and pushing realtime updates?"). Phase 8 adds ~14 new series across five tiers so they all flow to Prometheus/Grafana via the existing `/api/metrics`.

**Decisions locked for this implementation (from clarifying questions):**
- **All five tiers** land in this pass.
- **Admin in-app graphs deferred** — new series reach Grafana automatically through `/api/metrics`; we do **not** touch `ap_metric_snapshot`, `history.ts`, the snapshot job, or the admin page. No migration. (The Phase 8 "Done when" is satisfied by registry + `/metrics` + a unit test.)
- **HTTP golden signals via a per-route wrapper** (`withApiMetrics`) that each `route.ts` opts into with an explicit bounded template — not a `server.ts` path-normalizer.

**References:** `docs/plans/observability.md` Phase 8; CLAUDE.md (companion `.md` standing instruction, no `server-only` in runner-reachable modules, "don't add abstractions beyond the task", deviations recorded in plan). The registry/gauge/prometheus pattern is established in `src/lib/metrics/*`.

**The mechanism is fixed for every tier** (already proven by the existing three metrics):
1. Add a metric-name constant + `defineCounter`/`defineHistogram` call in `registerCore()` in `src/lib/metrics/registry.ts` (pre-registration keeps the snapshot shape stable).
2. Histogram buckets are constants in `aperture.config.ts`.
3. Emit at the call site via `metrics.incrementCounter(...)` / `metrics.observeHistogram(...)` (optionally through a small `record*` helper, like `recordEsiRequest`).
4. Gauges get a field in `GaugeReadings`, a line in `sampleGauges()`, and a row in `GAUGE_METRICS` (`prometheus.ts`); `/metrics` picks counters/histograms up automatically.
5. **Label cardinality is the main risk** — labels stay within the fixed task vocabulary / bounded route templates / known outcomes. Never label by map id, character id, ship type id, or raw URL.

---

## New config constants — `aperture.config.ts`

Add three histogram bucket arrays next to `METRICS_ESI_LATENCY_BUCKETS_MS` / `METRICS_ROUTE_LATENCY_BUCKETS_MS`:

- `METRICS_HTTP_LATENCY_BUCKETS_MS: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]`
- `METRICS_JOB_DURATION_BUCKETS_MS: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]` (jobs run longer than requests)
- `METRICS_FANOUT_LATENCY_BUCKETS_MS: [1, 2, 5, 10, 25, 50, 100, 250]` (in-process fanout is sub-ms to tens of ms)

---

## `src/lib/metrics/registry.ts` — new constants, registration, helpers

Add the constants and register them in `registerCore()`:

**Counters:** `MAP_EVENTS_TOTAL='map_events_total'`, `REALTIME_BROADCASTS_TOTAL='realtime_broadcasts_total'`, `PG_NOTIFY_RECEIVED_TOTAL='pg_notify_received_total'`, `HTTP_REQUESTS_TOTAL='http_requests_total'`, `JOB_RUNS_TOTAL='job_runs_total'`, `LOCATION_POLLS_TOTAL='location_polls_total'`, `CHARACTER_JUMPS_TOTAL='character_jumps_total'`, `ERROR_LOG_EVENTS_TOTAL='error_log_events_total'`, `WEBHOOK_DELIVERIES_TOTAL='webhook_deliveries_total'`, `ESI_TOKEN_REFRESH_TOTAL='esi_token_refresh_total'`, `JWK_CACHE_REFRESH_TOTAL='jwk_cache_refresh_total'`.

**Histograms:** `REALTIME_FANOUT_DURATION_MS='realtime_fanout_duration_ms'`, `HTTP_REQUEST_DURATION_MS='http_request_duration_ms'`, `JOB_DURATION_MS='job_duration_ms'`.

Where a call site needs more than one emit (counter + histogram together), add a small `record*` helper mirroring `recordEsiRequest`. Add new outcome string-literal types to `src/types/index.ts` alongside `EsiMetricOutcome` (e.g. `WebhookOutcome`, `TokenRefreshOutcome`, `LocationPollOutcome`) so labels stay typed at the call site.

---

## Tier 1 — realtime / mutation pipeline

- **`map_events_total{task}`** — `src/lib/map/mutations/core.ts`, in `commitMapEvent`, right after the `apMapEvent` insert succeeds. `task` = the event `kind` (bounded 17-value `MAP_EVENT_KINDS`).
- **`realtime_broadcasts_total{task}` + `realtime_fanout_duration_ms`** — `src/lib/realtime/bus.ts`, in the `dispatch` handler. `task` = the bounded envelope vocabulary (`mapUpdate` default, else `characterUpdate` / `characterLogout` / `systemNotification` / `connectionMassLog` from `taskTag`). Wrap the listener-delivery loop with `performance.now()` for the fanout duration (no labels). **Decision:** `realtime_fanout_duration_ms` measures the in-process dispatch→deliver span (entering `dispatch()` through delivering to all subscribers), not wall-clock from `pg_notify` emit — envelopes carry no consistent emit timestamp, so the span is the well-defined, cheap signal.
- **`pg_notify_received_total{channel}`** — `src/lib/realtime/bus.ts` `dispatch`, once per received notification. **Decision (cardinality):** the raw channel is `map:<mapId>` (unbounded); collapse to a bounded **channel-class** label `channel='map'`. This guards cardinality while still exposing a notify-stall signal.

## Tier 2 — HTTP golden signals (per-route wrapper)

- New `src/lib/metrics/httpInstrumentation.ts` (+ `.md`): `withApiMetrics(template, handler)` wrapping a Next App-Router handler `(req: NextRequest, ctx) => Promise<Response>`. It times the call with `performance.now()`, reads `response.status`, then emits `http_requests_total{route: template, method: req.method, status}` and `http_request_duration_ms{route: template}`. On a thrown error it records `status='500'` and re-throws. No `server-only` import.
- Convert each route handler from `export async function POST(...)` to `export const POST = withApiMetrics('/api/map/:mapId/systems', async (...) => {...})`. The `template` is passed **explicitly** (bounded) — dynamic segments written as `:mapId`, `:systemId`, etc.
- **Scope:** wrap every handler under `src/app/api/**/route.ts` **except** the meta/auth endpoints — skip `/api/metrics` (self-scrape noise), `/api/health` + `/api/health/ready` (frequent external monitor, and they predate this), and `/api/auth/[...nextauth]` (Auth.js owns those exports). Representative files: `src/app/api/map/[mapId]/signatures/route.ts`, `.../systems/[systemId]/route.ts`, `.../connections/[connId]/route.ts`, `.../route-plan/route.ts`, `src/app/api/structures/route.ts`, `src/app/api/statistics/route.ts` (~37 files total, same mechanical edit each).

## Tier 3 — background jobs

- **`job_runs_total{task,outcome}` + `job_duration_ms{task}`** — `src/lib/jobs/withInstrumentation.ts`, at the existing success/failure choke points. `task` = the job `name`; `outcome` = `'success'|'failure'`. Time the wrapped `run()` with `performance.now()` for the histogram.
- **`location_polls_total{outcome}`** — `src/lib/jobs/tasks/locationPoll.ts`. Classify the `PollNotes` result into one bounded outcome (`'no-payload'|'no-tracking'|'character-inactive'|'character-missing'|'token-loss'|'online'|'offline'|'esi-outage'`) and increment once per invocation. Centralize the classify-and-increment just before the (single or each) return.
- **`character_jumps_total`** — `src/lib/map/connectionMassLog.ts` `logConnectionJump`, once per recorded jump (after the insert, where `mass !== null`). **No labels** — connection/ship-type ids are unbounded, so this stays a label-free volume counter.

## Tier 4 — cheap gauges

- **`error_log_events_total{source}`** — `src/lib/log/logger.ts`, in `persist()` after a successful insert. `source` = `'server'|'job'|'client'` (bounded). Counter, so labels are fine.
- **db pool gauges** — `src/lib/metrics/gauges.ts`: read `pool.totalCount` / `idleCount` / `waitingCount` (import `pool` from `@/db/client`), add the fields to `GaugeReadings` (`src/types/index.ts`), and add rows to `GAUGE_METRICS` in `prometheus.ts`. **Decision (deviation from plan's `db_pool_connections{state}`):** the gauge layer is intentionally label-free (`GaugeReadings` is a flat numeric record rendered as `{name} {value}`). Rather than add labeled-gauge support, emit three flat gauges — `db_pool_total_connections`, `db_pool_idle_connections`, `db_pool_waiting_connections` — a standard Prometheus pattern that needs zero formatter change. (Gauges are sampled at scrape time; no snapshot impact since admin graphs are deferred.)

## Tier 5 — integrations & auth

- **`webhook_deliveries_total{target,outcome}`** — `src/lib/webhooks/dispatcher.ts` `deliver()`. `target='discord'`; `outcome` from the `postDiscordWebhook` result: `'success'|'rate_limited'|'http_4xx'|'http_5xx'|'network_error'`. (Retry visibility already exists via `apMapWebhook.consecutiveFailures` + graphile-worker re-enqueue — no separate retry metric, to bound scope.)
- **`esi_token_refresh_total{outcome}`** — `src/lib/auth/eve-provider.ts` `refreshAccessToken`. Wrap the body in try/catch to classify `'success'|'missing_token'|'http_error'|'invalid_response'`, increment, then re-throw on failure. **No `character_id` label** (unbounded).
- **`jwk_cache_refresh_total{outcome}`** — `src/lib/auth/jwks.ts`. `jose` is `^6.2.3`, which supports a custom fetch via the `customFetch` symbol export. Pass `[customFetch]` to `createRemoteJWKSet` so each **actual remote JWKS fetch** increments the counter with `outcome='success'|'error'` — this measures genuine cache refreshes (the thing capped at one per 10s), not per-token verifies. If the symbol turns out unavailable in this version, fall back to counting signature-failure-triggered re-verifies in `verifyEveAccessToken`; verify `customFetch` exists before relying on it.

---

## Companion `.md` files (standing instruction)

Every `.ts` touched gets its companion `.md` updated in the same operation: `registry.md`, `gauges.md`, `prometheus.md`, `httpInstrumentation.md` (new), `bus.md`, `withInstrumentation.md`, `locationPoll.md`, `connectionMassLog.md`, `logger.md`, `dispatcher.md`, `eve-provider.md`, `jwks.md`, `core.md` (mutations), the wrapped `route.md` companions, and the `aperture.config` / `types` companions if present. Document only the new exported symbols / changed behaviour; no change-rationale prose (that lives in code comments).

## Tests

Extend `tests/unit/metrics-instrumentation.test.ts` (mirrors the existing `metrics.reset()` + `counterValue` / `histogram` helpers, DB mocked to `[]`):
- **Tier 1:** drive `commitMapEvent` (or directly assert via `metrics.incrementCounter(MAP_EVENTS_TOTAL, {task})` path) and read a non-zero `map_events_total{task}` series.
- **Tier 2:** invoke a handler wrapped by `withApiMetrics` with a fake `NextRequest`/`Response` and assert a non-zero `http_request_duration_ms{route}` and `http_requests_total{route,method,status}` series.

These two are the explicit Phase 8 "Done when" test requirements; add light coverage for the other new emitters where it's cheap (e.g. `withInstrumentation` outcome labels).

---

## Verification

1. **CI gate:** run `pnpm lint`, `pnpm typecheck`, `pnpm build` via the `ci-verifier` agent after the work.
2. **Unit:** `pnpm vitest run tests/unit/metrics-instrumentation.test.ts` — new Tier 1/Tier 2 assertions pass.
3. **End-to-end (`METRICS_ENABLED=1` + token):** drive a map mutation, an API request, a job run, a webhook delivery, and a token refresh, then `curl -H 'Authorization: Bearer $METRICS_TOKEN' http://localhost:3003/api/metrics` and confirm the Tier 1–5 series appear and move.
4. **Cardinality audit:** scan the `/metrics` output and confirm no per-map/character/ship/raw-url label values leaked — `map_events_total` only carries the 17 kinds, `http_*` only the bounded templates, `pg_notify_received_total` only `channel="map"`.

## Out of scope (recorded)

- `ap_metric_snapshot` columns, `history.ts` derivation, the snapshot job, and the admin recharts page are **not** modified — new series reach Grafana via `/api/metrics` only. Surfacing any of them on the in-app admin graphs is a separate follow-up (migration + history changes per series).
- Sentry/OTEL adapters remain deferred (plan-wide v1 decision).
