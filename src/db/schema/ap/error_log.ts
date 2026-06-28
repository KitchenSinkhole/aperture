import { bigint, bigserial, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { errorLevel, errorSource } from './enums';
import { apCharacter } from './character';

// Bounded server/job/client error history. One row per persisted error-level
// log (written by the structured logger's `error`/`fatal` path, plus the Phase 7
// client-error ingest). The bulk of logging stays on stdout JSON; only error
// severities land here so an aggregator-less self-hoster still has queryable
// error history (and Phase 5 graphs / Phase 6 alerting can read it).
//
// PARTITIONED DAILY by `occurred_at` via pg_partman — Drizzle can't emit
// partitioned DDL, so the migration (0045_error_log.sql) hand-writes the
// `PARTITION BY RANGE` table, the `partman.create_parent` call, and the 30-day
// retention `part_config` row. This Drizzle definition exists only for type
// inference; the partition key must be part of the PK, hence the composite
// `(id, occurred_at)`.
//
// `context` is scrubbed before insert (`scrubContext` in `src/lib/log/scrub.ts`)
// — no character names / IPs / emails; a character *id* is allowed.
export const apErrorLog = pgTable(
  'ap_error_log',
  {
    id: bigserial('id', { mode: 'bigint' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    level: errorLevel('level').notNull(),
    source: errorSource('source').notNull(),
    message: text('message').notNull(),
    // Erasing a character must not cascade-wipe error history (CLAUDE.md audit rule).
    characterId: bigint('character_id', { mode: 'bigint' }).references(() => apCharacter.id, {
      onDelete: 'set null',
    }),
    context: jsonb('context'),
  },
  (t) => [primaryKey({ columns: [t.id, t.occurredAt] })],
);
