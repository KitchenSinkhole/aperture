# Remove Scaling Ceilings

**Goal:** Remove three non-hardware resource ceilings that degrade every Aperture deployment as it accrues tracked characters and viewers, surfaced by the 2026-07-02 prod metrics + read-only SSH investigation: unbounded `ap_job_run` growth, accumulating zombie `location-poll` jobs, and the shared-bucket killmail rate-limit ceiling. These worsen on any deployment over time; a larger public deployment just reaches them sooner.
**References:** `src/lib/jobs/withInstrumentation.ts`, `src/lib/jobs/tasks/locationPoll.md`, `src/lib/jobs/runner.md`, `src/lib/metrics/gauges.md`, `src/lib/metrics/history.md`, `src/lib/map/killboard.ts`, `src/db/schema.md` (`universe_entity_name` cache precedent), `aperture.config.ts`. CLAUDE.md rules: `universe_` prefix for CCP-data tables, hand-written migrations since 0011 (apply before tests), `jsonb`/`timestamptz`/`bigint` column rules, single canonical mutation pathways, no generic `active` boolean, history lives in `ap_map_event`.

Context, measured on prod (335 tracked chars, 43 concurrent viewers, alliance active-use peak): app 659 MB RAM / 3.7% CPU, DB 219 MB, load 1.74/8 cores. Compute is ~4x over-provisioned; none of the fixes below are hardware — they bound growth and rate-limit ceilings that no amount of provisioning solves. `ap_job_run` = 14.5M rows / 4.1 GB (91% of the DB), unpartitioned, +~825 rows/min. Job "backlog" = 19,552 dead `location-poll` rows with NULL key. Killmail fetches = ~28k/day, all from the on-demand killboard sidebar re-fetching immutable bodies.

---

## Stage 1 — Stop `ap_job_run` from growing unbounded
**Mode:** Plan mode (schema + instrumentation change with a metrics-read interaction to verify first)
**Goal:** Cut the write rate at the source and cap retention, so the table stops being 91% of the DB and stops scaling linearly with tracked characters.
**Touches:** `src/lib/jobs/withInstrumentation.ts`, `aperture.config.ts`, `src/db/migrations/0048_*.sql` (+ `.rollback.sql` + journal), `src/db/schema/ap/job_run.ts` + `.md`, `src/lib/metrics/history.md` (read-path interaction).
**Design:**
- **Write reduction (the source).** `withInstrumentation` writes one `ap_job_run` row per invocation; location-poll at 5s/char is ~98% of the volume. Persist **all failures**, but **sample successes** for high-frequency tasks (e.g. write 1-in-N successful `location-poll` rows; new `JOB_INSTRUMENTATION_SUCCESS_SAMPLE` constant). The Phase 8 `job_runs_total{task,outcome}` prometheus counter already carries the true aggregate success rate, so per-row success persistence is largely redundant.
- **Interactions to preserve:** (a) `history.ts` `loadMetricHistory` derives the admin "job success rate" chart by grouping `ap_job_run` rows into buckets — sampling changes that denominator; either scale the sampled count or point the chart at `job_runs_total` deltas instead. (b) `HEALTH_WORKER_STALE_MS` (`/api/health/ready`) needs a *finished* row within 15 min — sampling still emits those (character-cleanup/metrics-snapshot run every 1-5 min and are low-frequency, keep writing every row for those). Only sample the high-frequency tasks.
- **Retention.** Convert `ap_job_run` to pg_partman daily partitions with short retention (mirror `0046_metric_snapshot` / `0008_partman_retention`), e.g. 14 days, so old rows roll off via `DETACH/DROP PARTITION` on the existing `partition-maintenance` job. One-time purge of the current 14.5M-row backlog as part of the migration (or a bounded reaper first pass).
**Done when:** location-poll no longer writes a row per tick (verified via row-count delta over a few minutes), `ap_job_run` is partitioned with retention configured, the admin job-success chart and `/health/ready` still read correctly, CI green.

## Stage 2 — Kill the zombie `location-poll` jobs and stop them recurring
**Mode:** Plan mode (touches the poll failure-handling contract; verify no tracking regression)
**Goal:** Drive the job "backlog" to ~0 and prevent CCP-downtime / breaker outages from ever exhausting the retry budget again.
**Touches:** `src/lib/jobs/tasks/locationPoll.ts` + `.md`, `src/lib/metrics/gauges.ts` + `.md`, `src/lib/jobs/runner.md` (re-arm note), a one-time purge (runtime `DELETE` or bounded cleanup pass), optionally `src/lib/jobs/tasks/character-cleanup` for an ongoing sweep.
**Design:**
- **Root cause:** on `EsiDowntimeError` / `EsiBreakerOpenError` / post-refresh 401, the poll re-enqueues the next tick (via `addJob` `jobKeyMode:'replace'`) **and then re-throws**. The re-throw makes graphile increment `attempts` until `max_attempts`, permanently failing the row; graphile nulls its `key` on permanent failure and leaves it, and the boot re-arm only matches `key LIKE 'location-poll:%'` so never reaps it.
- **Fix:** for these *expected external outage* classes, **re-enqueue and return cleanly (no throw)** so `attempts` never climbs — the outage is already recorded via `location_polls_total{outcome='esi-outage'}` and the loop already scheduled its next tick. Genuine unexpected errors still throw and retry as today. This stops zombie accumulation at the source.
- **Gauge accuracy:** `sampleGauges().jobBacklog` counts unlocked+due rows without filtering `attempts < max_attempts`, so it over-reports dead jobs as backlog. Add the `attempts < max_attempts` filter so the gauge (and the `esi_breakers`/backlog alerting built on it) reflects real runnable work.
- **One-time purge:** delete the ~19.5k existing NULL-key exhausted `location-poll` rows.
**Done when:** exhausted-NULL-key `location-poll` rows are gone and stay near-0 across a CCP downtime window, `job_backlog` reflects only genuinely-runnable jobs, live tracking unaffected (verify `location-poll` success rate over 15 min), CI green.

## Stage 3 — Persistent killmail cache (immutable bodies fetched once, ever)
**Mode:** Accept edits (clear spec: new cache table + cache-aside + reaper, mirrors `universe_entity_name`)
**Goal:** Collapse `getKillmail` volume to only genuinely-new kills so the shared app-wide killmail rate-limit bucket (3600 tokens / 15 min ≈ 1800 fetches/15 min) stops being a scaling ceiling.
**Touches:** new `src/db/schema/universe/killmail.ts` + `.md`, barrel `src/db/schema/index.ts`, types re-export `src/types/index.ts`, `src/db/migrations/0049_*.sql` (+ rollback + journal), `src/lib/map/killboard.ts` + `.md`, new `src/lib/jobs/tasks/killmailCleanup.ts` + `.md`, `src/lib/jobs/registry.ts` + `.md`, `aperture.config.ts` (retention constant + cron).
**Design:**
- **Table `universe_killmail`** (CCP data / ESI-fed cache, beside `universe_entity_name`): `killmail_id` bigint PK, `hash` text NOT NULL, `body` jsonb NOT NULL (raw decoded ESI killmail), `killmail_time` timestamptz NOT NULL (extracted from body; indexed — retention key), `fetched_at` timestamptz NOT NULL default now(). No FK to `universe_system` (a kill can reference a system the SDE snapshot lacks; validate at boundary only).
- **Cache-aside** in `killboardForSystem`: after `recentKillsForSystem`, batch `SELECT ... WHERE killmail_id IN (...)`; `getKillmail` only the misses (still via `esiCall`, breaker-gated); `INSERT ... ON CONFLICT DO NOTHING` the fetched bodies; enrich from the union. Killmails are immutable, so a hit is authoritative forever — never re-fetch a cached id.
- **Retention reaper** `killmail-cleanup` (graphile cron, batched like other cleanup jobs): `DELETE FROM universe_killmail WHERE killmail_time < now() - KILLMAIL_CACHE_RETENTION` (default 30 days). Relevance decays and zKB only returns recent kills, so age-by-kill-time is the right key. Not partitioned — expected volume is modest and a simple indexed reaper suffices.
- **Rate-limit posture:** with the cache, the 429/`Retry-After` client work drops from required to a cheap defensive follow-up (protects cold-cache bursts, e.g. many systems added at once, and other unauthenticated endpoints). Track separately, not a blocker.
**Done when:** repeat killboard opens of the same system issue zero `getKillmail` calls (verify via `esi_requests_total{operationId="GetKillmailsKillmailIdKillmailHash"}` staying flat across opens), the reaper bounds `universe_killmail` by kill age, CI green.
**Status: implemented.** `universe_killmail` table (schema + migration 0049, applied to dev DB), cache-aside `loadKillmails` in `killboard.ts`, `killmail-cleanup` daily reaper registered, `KILLMAIL_CACHE_RETENTION_DAYS`/`KILLMAIL_CLEANUP_CRON` config. `pnpm lint`/`typecheck`/`build` green; cache-write `ON CONFLICT DO NOTHING` idempotency and the batched reaper delete validated against the DB.

---

## Stage 4 — Per-table row-count metric
**Mode:** Accept edits (small, well-specified addition to the existing gauge layer)
**Goal:** Expose estimated row counts per logical table on `/api/metrics` so table growth — especially `ap_job_run` (Stage 1) and the new `universe_killmail` (Stage 3) — is graphable and alertable in Prometheus/Grafana rather than only visible via a manual `pg_class` query.
**Touches:** `src/types/index.ts` (`TableRowEstimate` type + `tableRows` on `GaugeReadings`), `src/lib/metrics/gauges.ts` (`sampleTableRows`), `src/lib/metrics/prometheus.ts` (labelled gauge render + narrow the flat `GAUGE_METRICS` key type), `tests/unit/metrics-prometheus.test.ts`, companions (`gauges.md`, `prometheus.md`, `types/index.md`).
**Design:**
- Emit one labelled gauge `db_table_rows{table="…"}` — kept out of the flat `GAUGE_METRICS` table because it carries a label (the layer is otherwise label-free).
- Source counts from `pg_class.reltuples` (planner estimate, no table scan) so it's safe to sample on every scrape and every 1-min snapshot. Never-analyzed relations report `-1`; clamp negatives to 0.
- **Sum partition leaves under their parent** so the label set stays bounded to the ~dozens of logical tables instead of growing one series per daily partition (an unbounded label set is against the registry's bounded-label rule).
- Scope to `ap_*` / `universe_*` by name prefix so the set is self-maintaining (new tables appear automatically). Fail soft to `[]` on query error rather than sinking the scrape.
- **Scrape-only** — not persisted to `ap_metric_snapshot` (the table set is dynamic and wouldn't fit fixed columns); Prometheus owns retention. The admin metrics history page is unaffected.
**Done when:** `db_table_rows{table}` emits one series per logical table, partitions aggregate under the parent (no per-partition leakage), and the render unit test + typecheck are green.
**Status: implemented.** `src/types/index.ts`, `src/lib/metrics/gauges.ts`, `src/lib/metrics/prometheus.ts` + companions and `tests/unit/metrics-prometheus.test.ts`. Render test 5/5, `pnpm typecheck` clean, query validated against prod (45 bounded logical-table series; partitions aggregate).

---

**Sequencing:** Stages are independent; recommended order 1 → 2 → 3 (biggest disk/DB relief first). Stage 4 is low-risk and independent — it can ship anytime, and pairs naturally with Stage 1 since it makes the `ap_job_run` growth it addresses continuously observable. Stages 1 and 2 are worth shipping to every deployment immediately, since disk and zombie count grow every day on any of them. Claim migration numbers at implementation time (0048/0049) to avoid collisions with other branches.
