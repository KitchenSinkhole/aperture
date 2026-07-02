import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Per-invocation telemetry for the graphile-worker tasks. Written by
// `withInstrumentation` (src/lib/jobs/withInstrumentation.ts)
// around every handler call: one row inserted at start, finalised at end with
// success/error/notes. Surfaces per-job success metrics.
//
// PARTITIONED DAILY by `started_at` via pg_partman (migration 0048) with 14-day
// retention reaped by the partition-maintenance job — Drizzle can't emit
// partitioned DDL, so the migration hand-writes the `PARTITION BY RANGE` table,
// `partman.create_parent`, and the `part_config` retention row. This Drizzle
// definition exists for type inference; the partition key must be part of the PK,
// hence the composite `(id, started_at)`.
//
// graphile-worker's own tables live in the `graphile_worker` schema and are
// managed by its `runMigrations` API on first boot — those track queued/locked
// jobs, not historical outcomes. This table is the historical record we keep.
export const apJobRun = pgTable(
  'ap_job_run',
  {
    id: bigserial('id', { mode: 'bigint' }),
    name: text('name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    success: boolean('success'),
    errorText: text('error_text'),
    notes: jsonb('notes'),
    weight: integer('weight').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.startedAt] }),
    index('ap_job_run_name_started_at_idx').on(t.name, t.startedAt.desc()),
  ],
);
