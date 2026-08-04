## sdeRefresh task

**Purpose:** Daily cron that checks CCP's published SDE build against `ap_sde_state` and ingests a newer one through the isolated child-process path — the self-refresh loop with no operator involved.
**File:** `src/lib/jobs/tasks/sdeRefresh.ts`

---

### sdeRefresh: JobModule
Registered task `'sde-refresh'`, cron `'15 12 * * *'` (12:15 UTC — shortly after the ~11:29 UTC window CCP publishes builds in, outside the `CCP_SSO_DOWNTIME` back-off). Payload-less, so it also falls into `onDemandJobModules()` for a manual `/setup` trigger.

Each run:
1. Reads `ap_sde_state.current_build`; if the row is absent, seeds it with the pinned `SDE_BUILD`/`SDE_RELEASE_DATE` (a deployment upgrading in place without a prior ingest through this codebase).
2. Fetches `fetchLatestSdeManifest()` ([[ingest]]) and upserts `latest_build`/`latest_release_date`/`checked_at` unconditionally — staleness is visible even when no refresh is attempted.
3. If `latest_build <= current_build`, returns `{ refreshed: false }` — nothing to do.
4. Otherwise runs `runSdeIngestChild({ build, releaseDate })` ([[sdeIngestChild]]), the same isolated-child path `sde-ingest` uses. On success `runIngest`'s own `ap_sde_state` write (Stage 1) records the new `current_build` and clears the failure fields. On failure, writes `failed_at`/`failure_reason`/`consecutive_failures` (incremented) onto `ap_sde_state` directly, then re-throws so `withInstrumentation` also records the `ap_job_run` failure — a failed gate inside the child (`SdeFormatError`/`SdeGateError`) never partially writes, since `runIngest` writes nothing until every gate passes.

**Returns** (as `ap_job_run.notes`): `{ latestBuild, currentBuild, refreshed, counts? }`.

### Depends On
- `fetchLatestSdeManifest`, `SDE_BUILD`, `SDE_RELEASE_DATE` (`@/lib/sde/ingest`).
- `runSdeIngestChild` ([[sdeIngestChild]]).
