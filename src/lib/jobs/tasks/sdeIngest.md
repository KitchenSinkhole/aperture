## sdeIngest task

**Purpose:** graphile-worker wrapper that spawns an isolated `runIngest` child process so the setup wizard can trigger an on-demand SDE refresh without shelling into the container or degrading realtime/location-tracking.
**File:** `src/lib/jobs/tasks/sdeIngest.ts`

---

### sdeIngest: JobModule
Registered task `'sde-ingest'`. No cron — enqueued only via the setup wizard's `setupRunSdeIngest()` Server Action (which calls `graphile_worker.add_job('sde-ingest', '{}'::json)`). The CLI path (`pnpm sde:bootstrap`) still bypasses graphile-worker and calls `runIngest()` directly, in-process.

The handler spawns `scripts/sde-ingest-child.ts` by running the project's own `node_modules/tsx/dist/cli.mjs` under the current `node` binary (`process.execPath`, no shell — avoids OS-specific `.bin/tsx` resolution and unescaped-argument spawning), with `DB_POOL_MAX=2` in its env so the child opens a small dedicated `pg.Pool` instead of sharing the runner's. It collects the child's stdout/stderr, resolves with the last stdout line parsed as JSON (the child's `IngestResult`) on a zero exit, and rejects with the last `~20` stderr lines on a non-zero exit or unparseable output.

**Returns** (as `ap_job_run.notes`): the `IngestResult` from the child — `{ build, counts }`.

### Notes
- Long-running (downloads the SDE zip, bulk-inserts ~tens of thousands of rows) but off the runner's event loop and pool — a dev map stays realtime-connected and tracked characters keep moving while an ingest runs.
- Idempotent — `runIngest` upserts everything via `onConflictDoUpdate`; re-running against the same pinned `SDE_BUILD` is a no-op write-wise. Killing the child mid-run surfaces as a failed `ap_job_run`; re-running completes normally.
- Occupies one `JOB_WORKER_CONCURRENCY` slot for the run's duration (awaiting the child), same as any other job.
- Scheduled SDE-delta refresh (using CCP's `changes/<build>.jsonl` automation feed) is not yet built; this module is the operator-driven path.
