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
 * spike, and — if they resolved different builds — run deletion sync with
 * different keep sets, so the older run deletes the newer build's rows.
 */
export const SDE_QUEUE = 'sde';
