## queues.ts

**Purpose:** Named graphile-worker queue constants — the mutual-exclusion groups task modules declare via `JobModule.queue`.
**File:** `src/lib/jobs/queues.ts`

---

### SDE_QUEUE: string
The queue the static-data pipeline runs under (`sde-ingest`, `sde-refresh`, `csv-ingest`). graphile-worker locks a named queue while one of its jobs runs, so these three never overlap regardless of `JOB_WORKER_CONCURRENCY`.

Two SDE ingests at once each parse the full ~100MB build, doubling the memory spike, and — if they resolved different builds — run deletion sync with different keep sets, so the older run deletes rows the newer one just wrote.

### Notes
- Lives outside `registry.ts` so task modules can name a queue without importing the registry that imports them.
- A failed job releases its queue lock, so a persistently failing job delays but does not permanently block the others.
