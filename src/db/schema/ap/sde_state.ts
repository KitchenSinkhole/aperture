import { sql } from 'drizzle-orm';
import { check, date, integer, jsonb, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';

// `ap_sde_state` is a singleton row (enforced `id = 1`) recording which SDE
// build the database holds and how the self-refresh job is going. Written by
// `runIngest` (`src/lib/sde/ingest.ts`) on every successful full ingest and by
// the `sde-refresh` job on every check/attempt. The `(app)` layout banner and
// `/setup` both read it; neither queries the ingest process directly.
export const apSdeState = pgTable(
  'ap_sde_state',
  {
    // Singleton: there is exactly one state row, pinned to id 1.
    id: smallint('id').primaryKey().default(1),
    currentBuild: integer('current_build'),
    currentReleaseDate: date('current_release_date', { mode: 'string' }),
    latestBuild: integer('latest_build'),
    latestReleaseDate: date('latest_release_date', { mode: 'string' }),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    // When a check first observed `latest_build > current_build`, held across
    // subsequent checks until the two converge. Staleness is measured from
    // here rather than `latest_release_date` (a date, so it carries no publish
    // time) or `checked_at` (which resets on the very check that discovers the
    // gap).
    behindSince: timestamp('behind_since', { withTimezone: true }),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    // Rows a deletion-sync pass would have removed but kept because something
    // still references them, keyed by table name.
    retainedOrphans: jsonb('retained_orphans'),
    // Group-988 wormhole types present in the current build with no
    // `universe_wormhole` catalog row (Stage 5).
    uncatalogedWormholeCodes: jsonb('uncataloged_wormhole_codes'),
  },
  (t) => [check('ap_sde_state_singleton_chk', sql`${t.id} = 1`)],
);
