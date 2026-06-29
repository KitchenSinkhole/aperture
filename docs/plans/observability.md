# Aperture Observability

**Goal:** Give Aperture first-class observability — health, metrics, logging, alerting, and client error capture — so operators (the public deployment *and* self-hosters) learn something is wrong before users report it, and can correlate glitches with stats.

## Context

A recent outage on the public instance was caused by the VPS provider's networking, not Aperture itself — but nobody had any signal until users complained. There is currently **no health endpoint, no structured logging (just scattered `console.*`), no metrics export, no operational alerting, and no client-side error capture.** A contributor (Ionis) also asked specifically to export ESI rate/latency/failure, tracked-character count, system count, and route-calc time to a dashboard.

Two structural truths shape the design:
- **A deployment cannot monitor its own reachability** — only an *external* probe over the public internet catches "users can't reach me" (the actual incident). That part is ops/config, not code (Phase 0).
- **A status page hosted on the monitored box is useless during the outage it explains** — the public status page must live off-box (Phase 0).

**Design principle — two tiers:**
- **Core (built in-app, Postgres-only, zero extra infra):** works identically for the public instance and every self-hoster. This is the bulk of the plan.
- **Adapters (env-gated, later):** Sentry / OpenTelemetry exporters. **Explicitly out of scope for v1** (decision: self-contained v1). The `/metrics` Prometheus endpoint is the one export surface v1 ships.

**Decisions locked for this plan:**
- Operational telemetry → **new bounded `ap_` tables** (`ap_metric_snapshot`, `ap_error_log`), partitioned + reaped, following the `system_stats` / `signatureReap` patterns.
- Instance alert webhooks → **env vars only** (`ALERT_WEBHOOK_URL`, `STATUS_WEBHOOK_URL`); no admin UI, no `ap_instance` columns.
- **Self-contained v1** — Postgres + `/metrics` only; Sentry/OTEL deferred.
- **Scrub PII by default** — stored error/metric payloads carry no character names or IPs; operator alerts may reference a character *id* only.

**References:** `CLAUDE.md` (no-Redis / Postgres-only, mutation pathways, companion `.md` standing instruction, planning mode), and memory notes: migrations are **hand-written since 0011** (`.sql` + `.rollback.sql` + journal entry, applied before tests), finalized plans also belong in `docs/plans/`, runner-reachable modules must **not** import `server-only`.

### Reusable assets found (do not rebuild)
- `postDiscordWebhook(url, payload)` — `src/lib/integrations/discord.ts` — already-extracted Discord delivery primitive with timeout + 429/5xx retriable handling. Alerting reuses this directly.
- `withInstrumentation` + `ap_job_run` + `src/lib/jobs/queries.ts` (`summary`, `recentRuns`) — worker-liveness source of truth.
- ESI circuit breaker — `breakerState(operationId)` and `recordSuccess`/`recordFailure` in `src/lib/esi/{breaker,client}.ts`.
- `bus.isHealthy()` (`src/lib/realtime/bus.ts`), `pool` (`src/db/client.ts`) — health signals.
- `JobModule` registry pattern (`src/lib/jobs/registry.ts`), `signatureReap` (batch reap), `partitionMaintenance` (pg_partman) — for the snapshot job + retention.
- `recharts` (already a dependency), `(admin)` route group + `isAdmin(session)` (`src/lib/auth/rights.ts`) — for the admin metrics page.
- `requestJson` (`src/lib/http/fetchJson.ts`), `RealtimeProvider` (`src/lib/realtime/useRealtime.tsx`), `RealtimeStatusBanner` — patterns for client error capture + degraded UI.
- `aperture.config.ts` (`*_MS` / cron constants) and `src/lib/env.ts` (Zod, optional-with-default) — config/env conventions.

> Every `.ts`/`.tsx` touched needs its companion `.md` updated in the same operation.

---

## Phase 0 — External uptime + off-box status page
**Mode:** N/A (ops/config, no code)
**Goal:** Close the actual incident class — detect unreachability from outside, and host the public status page off-box.
**Work:**
- Stand up a free external uptime monitor (UptimeRobot / Better Stack) pinging the public site (and, once Phase 1 lands, `/api/health`) from outside the VPS.
- Host the public status page off-box (the uptime provider's hosted status page, or Instatus/GitHub Pages).
- Document both in `docs/` (or `README`) as the recommended self-hoster setup.
**Done when:** an external monitor alerts on unreachability and a public off-box status page exists. No repo code required.

## Phase 1 — Health endpoint
**Mode:** Accept edits
**Goal:** One internal source of truth for "am I healthy," consumed by the external monitor, alerting (Phase 6), and any status page.
**Touches:** `src/app/api/health/route.ts` (+ `.md`), small read helpers in `src/lib/health/probe.ts` (+ `.md`).
**Design:**
- Shallow `GET /api/health` → cheap `SELECT 1`; 200/503. This is the external-monitor target. Node runtime (DB pool access).
- Deep `GET /api/health/ready` → JSON component map: `db` (SELECT 1 on `pool`), `realtimeBus` (`bus.isHealthy()`), `worker` (most recent finished `ap_job_run` within an expected-cadence window, via `queries.ts`), `esi` (count of open breakers), `migrations` (latest applied). Overall status = worst component; 503 if any critical component down.
- Reuse `summary`/`recentRuns` from `src/lib/jobs/queries.ts` for worker liveness; do **not** import `server-only` in `probe.ts` (it must be safe for any runtime).
**Done when:** both routes return correct status against a running stack; killing the worker flips `worker` unhealthy.

## Phase 2 — Metrics instrumentation foundation
**Mode:** Accept edits
**Goal:** Produce the actual numbers (the shared dependency for both `/metrics` and the admin graphs). No consumer yet.
**Touches:** new `src/lib/metrics/registry.ts` (+ `.md`); instrument `src/lib/esi/client.ts`, `src/lib/map/routePlanner.ts`; gauge queries in `src/lib/metrics/gauges.ts`.
**Design:**
- In-process metric registry (counters / histograms / gauges), singleton across HMR via `globalThis` (mirror `bus.ts`). Plain TS — no Prometheus client lib needed yet; the registry exposes a snapshot object the `/metrics` formatter and snapshot job both read.
- **ESI (one wrap in `esiCall`)** — around the `fetch` + `recordSuccess`/`recordFailure` flow: counter `esi_requests_total{operationId,outcome}` (outcome = success / http_error / decode_error / breaker_open / downtime / rate_limited / token_error) and histogram `esi_request_duration_ms{operationId}`. Failure rate is derived from outcome labels. Also surface breaker open-count from `breakerState`.
- **Route calc** — wrap `planRoutes()` (`src/lib/map/routePlanner.ts`): histogram `route_plan_duration_ms`.
- **Gauges** (sampled at scrape/snapshot time): tracked characters (`count(ap_map_character_tracking)`), visible systems (`count(ap_map_system where visible)`), active WS connections, job backlog/abandoned. Plus process gauges (RSS/heap, event-loop lag).
- Histogram buckets defined as constants in `aperture.config.ts` (e.g. `METRICS_ESI_LATENCY_BUCKETS_MS`, `METRICS_ROUTE_LATENCY_BUCKETS_MS`).
**Done when:** a unit test exercises `esiCall`/`planRoutes` and reads non-zero counters/histograms from the registry.

## Phase 3 — `/metrics` Prometheus endpoint
**Mode:** Accept edits
**Goal:** Ionis's ask — export metrics for any Grafana/Prometheus. Cheapest consumer of Phase 2; stateless (Prometheus owns retention).
**Touches:** `src/app/api/metrics/route.ts` (+ `.md`); env additions in `src/lib/env.ts`; Prometheus text formatter in `src/lib/metrics/prometheus.ts` (+ `.md`).
**Design:**
- `GET /api/metrics` renders the registry snapshot in Prometheus text exposition format. Gauges computed at request time.
- Gated by env: `METRICS_ENABLED` (default `false`) + `METRICS_TOKEN` (Bearer/`?token=`); 404 when disabled, 401 on bad token. Self-hosters opt in; the public deployment sets a token.
- Exposes Ionis's six (ESI rate/latency/failure via labels, tracked-character gauge, system gauge, route-calc histogram) plus the infra gauges.
**Done when:** `curl -H 'Authorization: Bearer …' /api/metrics` returns valid exposition format; a local Prometheus scrapes it. **Ship + reply to Ionis with the committed metric list.**

## Phase 4 — Structured logging + `ap_error_log`
**Mode:** Plan mode (touches many files; logger choice + scrubbing policy)
**Goal:** Replace scattered `console.*` with a structured logger, and persist scrubbed error-level logs so even an aggregator-less self-hoster has server error history.
**Touches:** new `src/lib/log/logger.ts` (+ `.md`) wrapping **pino**; migrate `console.*` call sites in hot paths (`src/lib/esi/client.ts` incl. the TEMP 401 diagnostic, `src/lib/jobs/*`, `src/lib/realtime/*`, `server.ts`, API routes); new schema `src/db/schema/ap/error_log.ts` (+ `.md`); hand-written migration; reap task `src/lib/jobs/tasks/errorLogReap.ts` (+ `.md`).
**Design:**
- pino → JSON to stdout (self-hoster `docker logs`/journald). Thin wrapper so call sites are import-stable; **no `server-only`** import (runner-reachable).
- `ap_error_log`: partitioned by `occurred_at` (pg_partman, like `system_stats`), bounded retention (~30d), columns: `occurred_at`, `level`, `source` (server/job/client), `message`, `context jsonb` (**scrubbed** — no names/IPs; character *id* allowed). Error-level logs are persisted here in addition to stdout.
- Reap/retention via `errorLogReap` following `signatureReap` + `partitionMaintenance`.
- Add a lint guard (or doc rule) against new `console.*` outside the logger.
**Done when:** hot-path logs are structured JSON; an error-level log lands a scrubbed `ap_error_log` row; reap prunes beyond retention.

## Phase 5 — Admin metrics page
**Mode:** Accept edits
**Goal:** In-app graphs so any self-hoster gets an at-a-glance overview with zero external infra.
**Touches:** new schema `src/db/schema/ap/metric_snapshot.ts` (+ `.md`) + hand-written migration; snapshot job `src/lib/jobs/tasks/metricsSnapshot.ts` (+ `.md`) registered in `registry.ts`; admin page `src/app/(admin)/admin/metrics/page.tsx` (+ `.md`) + recharts client component.
**Design:**
- `/metrics` is point-in-time; graphs need history → snapshot job samples the Phase 2 registry into `ap_metric_snapshot` on a cron (e.g. every 1–5 min, constant in `aperture.config.ts`), partitioned + reaped (~30d), reusing the partition/reap pattern. Counters/histograms stored as periodic rollups; gauges as instantaneous values.
- Admin page (gated by `isAdmin(session)` like the rest of `(admin)`) renders recharts line/area graphs: ESI rate & latency & failure %, route-calc latency, tracked characters, system count, server load (RSS/event-loop lag), job success rate.
**Done when:** the admin metrics page renders multi-day graphs from `ap_metric_snapshot` on a running instance.

## Phase 6 — Instance alerting (Discord) — SHIPPED
**Mode:** Plan mode (alert rules + dedup state machine are the design-heavy part)
**Goal:** Push to Discord when something is wrong — terse public status updates + detailed operator alerts.

**DEVIATION FROM ORIGINAL DESIGN (recorded per CLAUDE.md):** the original plan below called
for a **graphile-worker cron job** plus a DB-backed **`ap_alert_state` table**. Both are
DB-dependent — graphile-worker scheduling needs a healthy DB to fire, and a DB-backed state
table can't be written while the DB is down. A primary thing we must alert on is the **DB
itself being degraded**, which a DB-backed alerter can never reliably do. Since `server.ts`
runs Next + WS + graphile-worker in **one process** (it already owns the ESI breaker `Map`, WS
counts, and `ap_job_run` writes), Phase 6 was instead built as an **in-process `setInterval`
loop with in-memory dedup state**:
- `src/lib/alerts/rules.ts` (+ `.md`) — pure rules (`evaluateRules`) + the dedup state machine
  (`reconcile`, mirroring `dispatcher.ts`'s `consecutive_failures`, debounced by
  `ALERT_DEBOUNCE_EVALUATIONS`) + Discord-payload formatting. Firing state is a `globalThis`
  singleton, **not a table** → no `ap_alert_state`, **no migration**, no `registry.ts` change.
- `src/lib/alerts/scheduler.ts` (+ `.md`) — the loop, booted from `server.ts` (next to
  `startZkbFeed`). Timeout-guarded signal gather (`SELECT 1` probe latency, worker staleness,
  abandoned jobs, recent `ap_error_log` errors, in-process breaker count); HTTP-only Discord
  delivery so it needs no DB.
- Rules: `db` (down/degraded by probe latency — the headline rule), `worker` (stale heartbeat),
  `esi_breakers` (≥N open), `job_abandoned`, `error_rate`. DB-backed signals degrade to
  `unknown` (no-op) during a DB outage so the `db` rule owns that case without false-resolves.
- Env: `ALERT_WEBHOOK_URL` (verbose operator, scrubbed) + `STATUS_WEBHOOK_URL` (terse public);
  loop no-ops when both empty. Thresholds in `aperture.config.ts` (`ALERT_*`).
- Tested by `tests/unit/alert-rules.test.ts` (DB-free — in-memory state makes the dedup machine
  directly unit-testable).

**Done when:** forcing a breaker open / killing the worker fires one operator alert and one resolve on recovery, with no repeat spam.

## Phase 7 — Client error capture
**Mode:** Accept edits
**Goal:** See when users hit errors in the browser.
**Touches:** global error boundary in `src/app/(app)/layout.tsx` (wrapping above `RealtimeStatusBanner`); a client handler (in `RealtimeProvider` effect or a dedicated `ClientErrorReporter`) for `window.onerror` / `unhandledrejection`; ingest route `src/app/api/client-errors/route.ts` (+ `.md`) writing to `ap_error_log` (`source='client'`).
**Design:**
- Handlers POST via `requestJson` to the ingest route: message, stack, route, UA — **scrubbed** (no character name/IP; session/character id only). Rate-limited per session and globally (in-process counter + bounded payload) to prevent a render-loop flooding the table.
- Errors land in `ap_error_log` (reused from Phase 4) and thus feed the Phase 6 error-rate rule and the Phase 5 graphs.
**Done when:** a thrown client error produces a scrubbed `ap_error_log` row; the boundary shows a recoverable fallback; rate-limit drops a flood.

## Phase 8 — Deepen instrumentation coverage — SHIPPED
**Mode:** Plan mode (many hot paths; each tier picks a hook point and label cardinality is a design decision)
**Implementation detail + recorded deviation:** see `docs/plans/observability-phase-8.md` (all five tiers shipped; per-route `route.md` companions intentionally not edited since the HTTP interface is unchanged).
**Goal:** Close the gap between "ESI is fine" and "is *Aperture itself* serving users and pushing realtime updates." Phases 2–3 instrumented the ESI egress + route calc + infra gauges; the realtime/mutation core, the app's own HTTP surface, per-task job flow, integrations, and auth are still dark — which is exactly the part that broke in the motivating incident.

**Mechanism (applies to every tier):**
- Counters/histograms must be **pre-registered in `src/lib/metrics/registry.ts`** (like the existing three) so every snapshot carries the full shape; emit via `metrics.incrementCounter` / `metrics.observeHistogram`. Add new metric-name constants alongside `ESI_REQUESTS_TOTAL` etc.
- Instantaneous gauges get a new key in `sampleGauges()` (`src/lib/metrics/gauges.ts`) + a row in the `GAUGE_METRICS` table in `src/lib/metrics/prometheus.ts`.
- Histogram buckets are constants in `aperture.config.ts` (mirror `METRICS_ESI_LATENCY_BUCKETS_MS`).
- **Label cardinality is the main risk** — keep labels to the fixed task vocabulary / bounded route templates / known outcomes; never label by map id, character id, or raw URL.
- Anything you want on the admin graphs (Phase 5) also needs a series in `ap_metric_snapshot`; the `/metrics` formatter (Phase 3) picks counters/histograms/gauges up automatically once registered.
- Every `.ts` touched gets its companion `.md` updated in the same operation. No `server-only` in any runner-reachable module.

### Tier 1 — realtime / mutation pipeline (biggest blind spot)
**Touches:** `src/lib/realtime/bus.ts`, `src/lib/realtime/wsServer.ts` (+ `.md`s); the `ap_map_event` insert path.
- `map_events_total{task}` — counter at the one `INSERT INTO ap_map_event` choke point (or the `pg_notify` emit in `bus.ts`). The canonical activity signal: one event per mutation, split by the fixed task vocabulary.
- `realtime_broadcasts_total{task}` + `realtime_fanout_duration_ms` — counter + histogram in the WS layer: envelopes pushed and `pg_notify`→socket-write latency. Complements the existing `ws_connections` gauge (which says nothing about whether fanout is flowing).
- `pg_notify_received_total{channel}` — counter on the `LISTEN` handler; a stall here while mutations continue is the silent-stale-state failure the degraded banner exists for.

### Tier 2 — HTTP golden signals (currently none)
**Touches:** `server.ts` or a shared API/Server-Action wrapper (+ `.md`s).
- `http_requests_total{route,method,status}` + `http_request_duration_ms{route}` — the rate/errors/duration triad for Aperture's *own* surface (the high-frequency signature-edit / drag / connection-change mutations), which today has no latency or error-rate signal. Use bounded route templates as the label, not raw paths.

### Tier 3 — background jobs (gauges exist, flow does not)
**Touches:** `withInstrumentation` / `ap_job_run` wrap (`src/lib/jobs/*`), `locationPoll`, `connectionMassLog` (+ `.md`s).
- `job_runs_total{task,outcome}` + `job_duration_ms{task}` — one add at the existing `withInstrumentation` choke point; turns the static `job_backlog`/`jobs_abandoned` gauges into per-task success-rate and duration trends.
- `location_polls_total{outcome}` + `character_jumps_total` — from the tracking poll and the `connectionMassLog` derivation; measures tracking health and real player-movement volume.

### Tier 4 — cheap gauges, high value
**Touches:** `src/lib/metrics/gauges.ts` (+ the `prometheus.ts` gauge table); error-log write path.
- `db_pool_connections{state}` — `pool.totalCount` / `idleCount` / `waitingCount` off `src/db/client.ts`; pool saturation is a classic silent killer and a free read.
- `error_log_events_total{source}` — counter where rows land in `ap_error_log` (server/job/client); exposes to Grafana the same rate the Phase 6 error-rate rule already consumes.

### Tier 5 — integrations & auth
**Touches:** webhook dispatcher (`postDiscordWebhook` path), `src/lib/auth.ts` token rotation + JWK cache (+ `.md`s).
- `webhook_deliveries_total{target,outcome}` (+ retry count) — the Slack/Discord fanout already classifies 429/5xx; surface its reliability.
- `esi_token_refresh_total{outcome}` + `jwk_cache_refresh_total` — token-rotation failures are a quiet way for tracking to die account-by-account; the JWK cache is capped at one re-fetch per 10s, so a refresh spike is a signal.

**Done when:** each tier's metrics register, appear in `/api/metrics`, move under real traffic, and graph in Grafana; label cardinality stays bounded (no per-map/character/url labels); a unit test exercises at least the Tier 1 `map_events_total` and Tier 2 `http_request_duration_ms` paths and reads non-zero series from the registry. Tiers are independently shippable — land Tier 1 + Tier 2 first (they close the incident-class gap).

---

## Verification (end-to-end)
- **CI gate after each phase:** `pnpm lint`, `pnpm typecheck`, `pnpm build` (run via the `ci-verifier` agent).
- **Migrations:** hand-write `.sql` + `.rollback.sql` + journal entry and apply to the dev DB **before** running DB tests (do not `db:generate`).
- **Health:** `curl /api/health` (200) and `/api/health/ready` (component map); kill the worker → `worker` unhealthy + 503.
- **Metrics:** drive some ESI calls + a route plan, then `curl -H 'Authorization: Bearer $METRICS_TOKEN' /api/metrics` and confirm Ionis's six are present and moving; scrape from a local Prometheus.
- **Logging:** confirm hot-path logs are JSON; trigger an error and confirm a scrubbed `ap_error_log` row.
- **Admin graphs:** let the snapshot job run, open `/admin/metrics`, confirm multi-point series render.
- **Alerting:** force an ESI breaker open (or stop the worker) → exactly one operator + one status message, then a single resolve on recovery; verify no PII in payloads.
- **Client capture:** throw in a client component → scrubbed `ap_error_log` row (`source='client'`), boundary fallback shows, flood is rate-limited.
- **Deepened instrumentation:** drive a map mutation, an API request, a job run, a webhook delivery, and a token refresh, then confirm the Tier 1–5 series appear in `/api/metrics` and move; verify no per-map/character/url labels leaked (cardinality stays bounded) and the new series graph in Grafana.
- **Integration tests** (`RUN_DB_TESTS`) for: health probe component states, the snapshot reap retention boundary, the alert dedup state machine, and the error-log scrubbing.
