## sdeIngest task

**Purpose:** graphile-worker wrapper that runs an isolated pinned-build SDE ingest so the setup wizard can trigger an on-demand refresh without shelling into the container or degrading realtime/location-tracking.
**File:** `src/lib/jobs/tasks/sdeIngest.ts`

---

### sdeIngest: JobModule
Registered task `'sde-ingest'`. No cron — enqueued only via the setup wizard's `setupRunSdeIngest()` Server Action (which calls `graphile_worker.add_job('sde-ingest', '{}'::json)`). The CLI path (`pnpm sde:bootstrap`) still bypasses graphile-worker and calls `runIngest()` directly, in-process.

The handler delegates to `runSdeIngestChild()` ([[sdeIngestChild]]), which spawns `scripts/sde-ingest-child.ts` as a child process with its own small dedicated `pg.Pool`. Unparameterized, so the child ingests the pinned `SDE_BUILD`.

**Returns** (as `ap_job_run.notes`): the `IngestResult` from the child — `{ build, counts }`.

### Notes
- Long-running (downloads the SDE zip, bulk-inserts ~tens of thousands of rows) but off the runner's event loop and pool — a dev map stays realtime-connected and tracked characters keep moving while an ingest runs.
- Idempotent — `runIngest` upserts everything via `onConflictDoUpdate`; re-running against the same pinned `SDE_BUILD` is a no-op write-wise. Killing the child mid-run surfaces as a failed `ap_job_run`; re-running completes normally.
- Occupies one `JOB_WORKER_CONCURRENCY` slot for the run's duration (awaiting the child), same as any other job.
- The daily `sde-refresh` task ([[sdeRefresh]]) covers scheduled delta refresh onto whatever build CCP has newly published; this task's build is always the pinned one.
