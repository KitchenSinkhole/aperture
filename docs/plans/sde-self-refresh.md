# SDE Self-Refresh

**Goal:** Aperture keeps its own static data current after Fenris Creations changes the game (new gates, systems, ships, effects, type changes, removals), and every user can see when it has failed to do so, without opening `/setup` or the logs.
**References:** `src/lib/sde/ingest.md`, `src/lib/jobs/registry.md`, `src/lib/jobs/runner.md`, `src/components/RealtimeStatusBanner.md`, `src/app/(app)/layout.tsx`, CLAUDE.md (mutation pathways, config rules, lifecycle patterns).

**Background:** The recurring Kassigainen–Pakhshi phantom wormholes (see `docs/plans/phantom-wormhole-stale-location-bug.md`) were caused by the Cradle of War expansion (2026-06-09) adding a stargate that the pinned SDE build 3351823 (2026-05-19) predates. `classifyJump` saw the systems as non-adjacent and mapped every gate transit as a wormhole for seven weeks, with no signal anywhere that the static data was stale. The pin exists to defend against SDE *format* drift (FC reorganizes the file layout periodically, and the hand-maintained wormhole CSVs bind against a known type table), but it currently freezes *content* freshness along with it. This plan separates the two: format drift must fail loudly, content must refresh itself.

**Key design decisions (agreed up front):**

- **`ap_sde_state` singleton table** records what build the database actually holds and how refresh is going: `current_build`, `current_release_date`, `latest_build`, `latest_release_date`, `checked_at`, `refreshed_at`, `failed_at`, `failure_reason`, `consecutive_failures`, plus `jsonb` detail fields (`retained_orphans`, `uncataloged_wormhole_codes`). Single row enforced with `id smallint primary key default 1 check (id = 1)` — a deliberate, recorded deviation from the `generated always as identity` rule, since a sequence on a singleton is noise. All timestamps `timestamptz`.
- **`SDE_BUILD` becomes the bootstrap floor, not the ceiling.** First ingest on an empty DB still uses the pinned build (reproducible bootstrap, cached zip, known-good CSV binding). The refresh job advances past it. The constant's comment changes to say so.
- **Staleness and failure surface in one place, to everyone.** A global banner in the `(app)` layout, next to `RealtimeStatusBanner`, driven by `ap_sde_state`. It shows either "static data is out of date" (behind latest beyond a grace window) or "static data could not be updated" (refresh failing). Same slot, one component, two messages. `/setup` keeps the detailed view (failure reason, orphan counts, uncataloged wormhole codes).
- **No new WS task names.** SDE state changes on a daily cadence; the banner fetches it (server-rendered in the layout plus a small JSON route the client refetches on a slow interval or tab focus). The fixed realtime task vocabulary is untouched.
- **Ingest runs out-of-process.** `server.ts` runs Next.js, the WS server, and the embedded graphile-worker in one Node process, and the worker shares the app's `pg.Pool` (`runner.md`). An in-process ingest therefore parses ~100MB of YAML on the serving event loop (starving WS heartbeats, which users see as the "connecting to live updates" banner) and pushes bulk upserts through the pool that location-poll and API queries need (tracking goes laggy or breaks). The ingest task instead spawns a child process with its own small dedicated pool; the job slot merely awaits the child. This fixes the existing `/setup`-triggered ingest as well as the future auto-refresh.
- **Refresh is gated, and a failed gate keeps serving old data.** The degraded state is always "stale but flagged", never "corrupted". Gates: Zod decoders on every SDE file at the parse boundary (format drift becomes a decoder error, mirroring the ESI rule), and per-table row-count shrink checks before any write (`SDE_REFRESH_MAX_SHRINK_PCT`).
- **Deletion sync covers all `universe_*` tables, FK-guarded.** Rows absent from the new build are deleted only when nothing references them; referenced rows are retained and counted into `ap_sde_state.retained_orphans` for operator review. Historically FC deletes almost nothing, but the mechanism must exist: a *removed* gate left in `universe_stargate_edge` is the mirror image of the Kassigainen–Pakhshi bug (a real wormhole silently classified as a gate) and is invisible without this.
- **The wormhole catalog CSVs stay hand-maintained** (anoik.is is frozen; do not regenerate). Self-refresh cannot invent catalog rows for new hole types, but it can *detect* them: group-988 wormhole types present in the new build with no `universe_wormhole` row are recorded in `ap_sde_state.uncataloged_wormhole_codes` and surfaced in `/setup`.
- **Cadence and thresholds are hard-coded constants**, not runtime knobs: cron expression on the job module (daily, shortly after the ~11:29 UTC window FC publishes builds in, outside the downtime back-off), `SDE_STALE_GRACE_HOURS` and `SDE_REFRESH_MAX_SHRINK_PCT` in `aperture.config.ts`.

**Non-goals:** The stale-location re-baseline guard stays with `docs/plans/phantom-wormhole-stale-location-bug.md` (demoted there to optional hardening; the phantom pair itself is fixed by Stage 0). The public spectator layout keeps its minimal chrome; the banner ships in the `(app)` layout only.

---

## Stage 0 — Bump the pin, fix the live bug
**Mode:** Accept edits
**Goal:** Deployments stop inventing Kassigainen–Pakhshi wormholes now, independent of the rest of this plan.
**Touches:** `src/lib/sde/ingest.ts` (`SDE_BUILD` → `3453885`, `SDE_RELEASE_DATE` → `2026-07-31`), `src/lib/sde/ingest.md`.
**Done when:** `pnpm sde:bootstrap` against the dev DB ingests build 3453885, printed counts are sane against the previous run (systems and edges grow, nothing shrinks unexpectedly), and `universe_stargate_edge` contains the four Cradle of War pairs (Kassigainen↔Pakhshi 30002761↔30005198, Kemerk↔Bania, Rayeret↔Jakri, Mehatoor↔Akes — resolve the latter three ids via `universe_system` by name). Note for ops: prod needs the same `sde:bootstrap` run after deploy.

## Stage 1 — `ap_sde_state` and build recording
**Mode:** Accept edits
**Goal:** The database knows which build it holds and when it last changed.
**Touches:** `src/db/schema/` (new `ap_sde_state` table per the design above + companion), new migration via `drizzle-kit generate` plus hand-written `.rollback.sql`, `src/lib/sde/ingest.ts` (`runIngest` upserts the row on success: `current_build`, `current_release_date`, `refreshed_at`; clears `failed_at`/`failure_reason`/`consecutive_failures`), `src/types/index.ts` (re-export inferred model), companions.
**Done when:** Migration applies and rolls back cleanly; `pnpm sde:bootstrap` writes the singleton row; re-running updates `refreshed_at` without duplicating the row. Existing deployments get the row on their first ingest or first check-job run (Stage 5 seeds `current_build` from `SDE_BUILD` when the row is absent — the constant compiled into the running app is what that deployment bootstrapped with).

## Stage 2 — Ingest isolation
**Mode:** Accept edits
**Goal:** A running SDE ingest no longer degrades realtime, location tracking, or page loads (fixes the current `/setup` symptom: minutes of "connecting to live updates" plus stalled jump tracking).
**Touches:** new `scripts/sde-ingest-child.ts` (+ companion) — a thin CLI over `runIngest` (later: `runIngest(build)`) that creates its own dedicated `pg.Pool` (2 connections), prints the per-table counts as JSON on stdout, exits non-zero on failure; `src/lib/jobs/tasks/sdeIngest.ts` (+ companion) — the task spawns the child (project-local `tsx`, env inherited so `DATABASE_URL` flows through), awaits exit, parses the counts into job notes, maps a non-zero exit (with a stderr tail) to a task failure. `csv-ingest` stays in-process — three small CSVs, no parse cost.
**Done when:** With a dev map open and a tracked character moving, triggering the `/setup` ingest card keeps the realtime banner green and pilot breadcrumbs flowing throughout the run; job notes still carry per-table counts; killing the child mid-run lands a failed `ap_job_run` with the stderr tail, and re-running completes (the ingest is already re-runnable upserts).
Note: awaiting the child occupies one of the `JOB_WORKER_CONCURRENCY` (4) slots for the duration, leaving three for location-polls — acceptable; do not raise the constant for this.

## Stage 3 — Boundary validation and acceptance gates
**Mode:** Plan mode
**Goal:** A malformed or shrunken SDE build can never partially overwrite good data; format drift fails loudly instead of silently.
**Touches:** `src/lib/sde/ingest.ts` (Zod decoders for each YAML file's entry shape at the parse boundary; full parse of the zip *before* the first write; per-table count comparison against the live tables failing the run when any table shrinks more than `SDE_REFRESH_MAX_SHRINK_PCT`; CSV re-binding integrity checks — every catalog code resolves against the new type table — promoted from eyeball checks to hard failures), `aperture.config.ts` (`SDE_REFRESH_MAX_SHRINK_PCT`), companions.
**Done when:** `runIngest` against the current build still passes end to end; a deliberately corrupted fixture zip (truncated `mapStargates.yaml`, renamed key) fails *before any row is written*, with a failure reason suitable for `ap_sde_state.failure_reason`. Plan mode because the decoder granularity and gate placement inside the existing chunked-upsert flow need design review, and this file is load-bearing for every deployment's bootstrap.

## Stage 4 — Deletion sync
**Mode:** Plan mode
**Goal:** Rows FC removed from the game leave our `universe_*` tables, unless application data still references them.
**Touches:** `src/lib/sde/ingest.ts` (post-upsert phase: for each ingested table, anti-join the new build's id set and delete absentees guarded by `NOT EXISTS` against every referencing table — enumerate referencing FKs from the Drizzle schema, including `ap_` tables and intra-`universe_` references; retained rows counted into `ap_sde_state.retained_orphans`), companions.
**Done when:** An integration test (RUN_DB_TESTS; snapshot and restore touched rows per the dev-DB conventions) shows: a synthetic edge absent from the build is deleted; a synthetic system referenced by an `ap_map_system` row is retained and counted; `universe_stargate_edge` full-syncs unconditionally (nothing references it). Plan mode because the referencing-FK enumeration and per-table policy need review before writing deletes.

## Stage 5 — The `sde-refresh` job
**Mode:** Accept edits
**Goal:** A daily cron notices a new build, ingests it through the gates, and records success or failure — no operator involved.
**Touches:** new `src/lib/jobs/tasks/sdeRefresh.ts` (+ companion, + registry entry): fetch `latest.jsonl`, upsert `latest_build`/`latest_release_date`/`checked_at` (seeding the row from `SDE_BUILD` if absent); when `latest_build > current_build`, run the parameterized ingest through the Stage 2 child wrapper; on success Stage 1's recording applies; on failure record `failed_at`/`failure_reason`, increment `consecutive_failures`, keep serving old data. `src/lib/sde/ingest.ts` (`runIngest`/`ensureSdeZip` take an optional build overriding the pinned constant; cache eviction of superseded zips; record `uncataloged_wormhole_codes` — group-988 types with no `universe_wormhole` row). Wrap in `withInstrumentation`; cron daily at 12:15 UTC.
**Done when:** With dev DB behind latest, one cron firing lands the new build and a clean `ap_sde_state`; with a gate forced to fail, state records the failure and the DB is unchanged. Constraint: everything the task imports must stay free of `'server-only'` (the runner is bare tsx).

## Stage 5.5 — A clock the grace window can actually measure
**Mode:** Accept edits
**Goal:** Give the staleness banner a defensible signal, and close the blind spot where a refresh that never runs shows nothing at all.
**Why:** Stage 6 as originally written could not be built honestly. `latest_build` only advances when `sde-refresh` succeeds at its check, so `current < latest` is unobservable in exactly the cases that matter most (runner down, manifest fetch failing every time) — the same silent staleness that caused Kassigainen–Pakhshi. And the grace window had no clock to run against: `latest_release_date` is a `date` with no publish time, `checked_at` resets on the very check that discovers the gap.
**Touches:** `ap_sde_state.behind_since` (migration 0064 + rollback), `aperture.config.ts` (`SDE_STALE_GRACE_HOURS`, `SDE_CHECK_STALE_HOURS`), `src/lib/jobs/tasks/sdeRefresh.ts` (set/clear `behind_since`; record a failure when the manifest fetch itself throws, not only the ingest), `src/lib/sde/ingest.ts` (clear `behind_since` on success), companions.
**Done when:** Migration applies and rolls back cleanly; a check that finds a gap stamps `behind_since` once and holds it across later checks; a converged check clears it; a successful ingest clears it.

## Stage 6 — Surfacing: global banner + `/setup` detail
**Mode:** Accept edits
**Goal:** Every signed-in user sees stale or failing static data; operators see why.
**Touches:** new `src/components/SdeStatusBanner.tsx` (+ companion) mounted beside `RealtimeStatusBanner` in `src/app/(app)/layout.tsx`; a small JSON route (e.g. `src/app/api/sde-status/route.ts`) returning the derived status for client refetch (slow interval + tab focus); `aperture.config.ts` (`SDE_STALE_GRACE_HOURS`); `/setup` console: status card reading the full `ap_sde_state` row (failure reason, consecutive failures, retained orphans, uncataloged wormhole codes) and a "refresh to latest now" action reusing the Stage 5 path alongside the existing pinned-build ingest card.
**Done when:** With `ap_sde_state` manipulated to each state, the banner shows: nothing when current; "out of date" when `behind_since` is past `SDE_STALE_GRACE_HOURS`, *or* when no check has landed in `SDE_CHECK_STALE_HOURS` (the runner-stopped case, which the build gap alone cannot see); "could not be updated" whenever the last attempt failed and the instance is still behind — both messages in the same slot, `failing` taking precedence. A deployment freshly bootstrapped from the pinned build, which has never checked, is not called stale. Banner copy contains no em-dashes. `/setup` shows the detail and the manual refresh works.
