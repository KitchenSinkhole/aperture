## sdeIngest task

**Purpose:** graphile-worker wrapper that re-runs an isolated SDE ingest against the build the database already holds, so the setup wizard can repair static data without shelling into the container or degrading realtime/location-tracking.
**File:** `src/lib/jobs/tasks/sdeIngest.ts`

---

### sdeIngest: JobModule
Registered task `'sde-ingest'` on the `SDE_QUEUE` ([[queues]]). No cron — enqueued only via the setup wizard's `setupRunSdeIngest()` Server Action. The CLI path (`pnpm sde:bootstrap`) bypasses graphile-worker and calls `runIngest()` directly, in-process, on the pinned build.

Each run:
1. Resolves the build from `ap_sde_state.current_build`/`current_release_date`, falling back to the pinned `SDE_BUILD`/`SDE_RELEASE_DATE` when the row is absent (a fresh database bootstrapping). Which build the ops console re-runs is decided here and passed as an explicit override, so `runIngest()` with no override keeps meaning "the pin".
2. Delegates to `runSdeIngestChild(override)` ([[sdeIngestChild]]), which spawns `scripts/sde-ingest-child.ts` as a child process with its own small dedicated `pg.Pool`.
3. On failure, writes `failed_at`/`failure_reason`/`consecutive_failures` onto `ap_sde_state` via `recordSdeFailure` ([[ingest]]) before re-throwing, so a failed on-demand ingest is visible in `/setup` and not only in `ap_job_run`.

**Returns** (as `ap_job_run.notes`): the `IngestResult` from the child — `{ build, counts }`.

### Notes
- Long-running (downloads the SDE zip if the cache lacks it, bulk-inserts ~tens of thousands of rows) but off the runner's event loop and pool — a dev map stays realtime-connected and tracked characters keep moving while an ingest runs.
- Idempotent — `runIngest` upserts everything via `onConflictDoUpdate`, and re-running against the build already recorded is a no-op write-wise. Killing the child mid-run surfaces as a failed `ap_job_run`; re-running completes normally.
- Resolving to `current_build` also means the zip `evictSupersededSdeZips` kept is the one this task needs, so a re-run on a refreshed deployment does not re-download ~100MB.
- A deployment stale enough that CCP has pruned its build fails at the download rather than falling back to the pin, which would be a downgrade. The recorded failure reason names it; "Refresh to latest" is the way forward from there.
- Occupies one `JOB_WORKER_CONCURRENCY` slot for the run's duration (awaiting the child), same as any other job.
- The shared queue makes it mutually exclusive with `sde-refresh` and `csv-ingest`: two ingests resolving different builds would run deletion sync with different keep sets, and the older one's would delete the newer build's rows.
- The daily `sde-refresh` task ([[sdeRefresh]]) covers moving onto a newer build CCP has published; this task never advances the build.
