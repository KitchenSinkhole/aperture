## sdeRefresh task

**Purpose:** Daily cron that checks CCP's published SDE build against `ap_sde_state` and ingests a newer one through the isolated child-process path — the self-refresh loop with no operator involved.
**File:** `src/lib/jobs/tasks/sdeRefresh.ts`

---

### sdeRefresh: JobModule
Registered task `'sde-refresh'`, cron `'15 12 * * *'` (12:15 UTC — shortly after the ~11:29 UTC window CCP publishes builds in, outside the `CCP_SSO_DOWNTIME` back-off), on the `SDE_QUEUE` ([[queues]]) so the cron and a manually enqueued ingest are mutually exclusive. `maxAttempts: 2` — the daily tick is the real retry, and a grinding ~100MB ingest holds the shared queue against `sde-ingest` and `csv-ingest`. Payload-less, so it also falls into `onDemandJobModules()` for a manual `/setup` trigger.

Each run:
1. Reads `ap_sde_state.current_build`; if the row is absent, seeds it with the pinned `SDE_BUILD`/`SDE_RELEASE_DATE` (a deployment upgrading in place without a prior ingest through this codebase).
2. Fetches `fetchLatestSdeManifest()` ([[ingest]]). A fetch that throws records `failed_at`/`failure_reason`/`consecutive_failures` via `recordSdeFailure` ([[ingest]]) before re-throwing, so a check that never reached its comparison is still named in `/setup`.
3. Upserts `latest_build`/`latest_release_date`/`checked_at` unconditionally, and sets `behind_since` from the comparison: `coalesce(behind_since, now())` when `latest_build > current_build` (holding the timestamp of the check that first saw the gap), `null` when the two agree. `getSdeStatus` ([[status]]) measures the staleness grace window against it. A check that finds the builds converged also clears `failed_at`/`failure_reason`/`consecutive_failures` — on a deployment that is already current nothing is ingested, so this is the only thing that retires a transient failure and keeps the counter consecutive. A check that finds the instance behind leaves them for the ingest that follows to decide.
4. If `latest_build <= current_build`, returns `{ refreshed: false }` — nothing to do.
5. Otherwise runs `runSdeIngestChild({ build, releaseDate })` ([[sdeIngestChild]]), the same isolated-child path `sde-ingest` uses. On success `runIngest`'s own `ap_sde_state` write records the new `current_build` and clears `behind_since` plus the failure fields. On failure, `recordSdeFailure` writes `failed_at`/`failure_reason`/`consecutive_failures` (incremented), then re-throws so `withInstrumentation` also records the `ap_job_run` failure — a failed gate inside the child (`SdeFormatError`/`SdeGateError`) never partially writes, since `runIngest` writes nothing until every gate passes.

**Returns** (as `ap_job_run.notes`): `{ latestBuild, currentBuild, refreshed, counts? }`.

### Depends On
- `fetchLatestSdeManifest`, `recordSdeFailure`, `SDE_BUILD`, `SDE_RELEASE_DATE` (`@/lib/sde/ingest`).
- `runSdeIngestChild` ([[sdeIngestChild]]).
