## job_run.ts

**Purpose:** The `ap_job_run` table — per-invocation telemetry for the graphile-worker tasks.
**File:** `src/db/schema/ap/job_run.ts`

---

### apJobRun
Drizzle table `ap_job_run`. Written by `withInstrumentation` (`src/lib/jobs/withInstrumentation.ts`) around every task handler invocation. Per-task success metrics are read off this table (see `src/lib/jobs/queries.ts` and `src/lib/metrics/history.ts`).

Full-fidelity tasks write two-phase (one row inserted at `started_at`, finalised at `ended_at`). High-frequency tasks (`location-poll`) sample successes: every failure is written, but a successful run is persisted only 1-in-`weight` and as a single completed insert (no in-flight row).

**Columns:**
- `id` (`bigserial`) — half of the composite PK.
- `name` (`text`) — graphile-worker task identifier (e.g. `signature-reap`, `eol-expiry`).
- `startedAt` (`started_at`, `timestamptz`, default `now()`) — handler start time; the partition key.
- `endedAt` (`ended_at`, `timestamptz`, nullable) — set when the handler returns/throws. `NULL` represents an in-flight (or crashed-mid-run) full-fidelity handler; sampled tasks never write a `NULL`-`ended_at` row.
- `success` (`boolean`, nullable) — `true` on clean return, `false` on throw, `NULL` while in flight.
- `errorText` (`error_text`, `text`, nullable) — truncated `Error.message` if the handler threw.
- `notes` (`jsonb`, nullable) — handler-returned details (e.g. `{ deleted: 12 }`).
- `weight` (`integer`, default `1`) — how many runs this row represents. Full-fidelity rows and failures are `1`; a sampled success row is `N` (the task's sample rate), so `sum(weight)` scales the sample back up when computing the job-success rate.

**Primary key:** composite `(id, started_at)` — the partition key (`started_at`) must be part of the PK. `id` remains globally unique via the sequence.

**Index:** `ap_job_run_name_started_at_idx` on `(name, started_at desc)` — supports the per-task "recent runs" lookup used by the operability view.

**Notes:**
- Daily-partitioned by `started_at` via pg_partman with 14-day retention; old partitions are dropped by the `partition-maintenance` job (no dedicated reaper). The `part_config` row is added by migration 0048.
- graphile-worker's own queue tables (`graphile_worker.jobs` etc.) are created and migrated by its `runMigrations` API on first boot. Those track queued/locked/failed *jobs*; `ap_job_run` is our historical record of *runs* (no FK to the queue).
