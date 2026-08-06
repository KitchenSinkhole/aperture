/**
 * Named graphile-worker queues. A queue is a mutual-exclusion group: the
 * worker pool locks a queue while one of its jobs runs, so jobs sharing a
 * queue never overlap even at `JOB_WORKER_CONCURRENCY > 1`.
 *
 * Declared here rather than in `registry.ts` so task modules can name their
 * queue without importing the registry that imports them.
 */

/**
 * The static-data pipeline (`sde-ingest`, `sde-refresh`, `csv-ingest`).
 *
 * Two ingests running at once each parse the full SDE, doubling the memory
 * spike. `pnpm sde:bootstrap` runs in-process outside the worker, so it can
 * still overlap a job-driven ingest despite this queue — the losing run's
 * `universe_sde_stage` keys get swept by the other run's staging pass and it
 * aborts on the empty-keep gate rather than deleting the winner's rows.
 */
export const SDE_QUEUE = 'sde';
