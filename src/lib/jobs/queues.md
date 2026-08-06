## queues.ts

**Purpose:** Named graphile-worker queue constants — the mutual-exclusion groups task modules declare via `JobModule.queue`.
**File:** `src/lib/jobs/queues.ts`

---

### SDE_QUEUE: string
The queue the static-data pipeline runs under (`sde-ingest`, `sde-refresh`, `csv-ingest`). graphile-worker locks a named queue while one of its jobs runs, so these three never overlap regardless of `JOB_WORKER_CONCURRENCY`.

Two SDE ingests at once each parse the full ~100MB build, doubling the memory spike. `pnpm sde:bootstrap` runs in-process outside the worker, so it can still overlap a job-driven ingest despite this queue; the losing run's staged deletion-sync keys (`universe_sde_stage`) get swept by the other run's staging pass, so it aborts on the empty-keep gate rather than deleting the winner's rows.

### Notes
- Lives outside `registry.ts` so task modules can name a queue without importing the registry that imports them.
- A failed job releases its queue lock, so a persistently failing job delays but does not permanently block the others.
