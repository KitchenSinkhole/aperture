import { sql } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Persistent cache of full ESI killmails, filled from two sources: the
// system-killboard's cache-aside fetch (zKillboard's per-system list only
// returns `{ killmailId, hash }`, so the body comes from a `getKillmail` call
// against the shared app-wide ESI rate-limit bucket), and the zKB live feed,
// which persists every kill in a system on an active map. Killmail bodies are
// immutable, so a cached row is authoritative forever and never re-fetched.
// Age-by-kill-time retention (see the `killmail-cleanup` job) bounds the table.
//
// CCP-fed data, hence `universe_`; no FK to `universe_system` because a kill can
// reference a system the SDE snapshot lacks (validated at the boundary only).
export const universeKillmail = pgTable(
  'universe_killmail',
  {
    // EVE killmail id is the natural 64-bit key — not generated.
    id: bigint('killmail_id', { mode: 'bigint' }).primaryKey(),
    hash: text('hash').notNull(),
    body: jsonb('body').notNull(),
    // Extracted from the body; the retention key.
    killmailTime: timestamp('killmail_time', { withTimezone: true }).notNull(),
    // Derived from the body so a per-system read can use an index.
    solarSystemId: integer('solar_system_id').generatedAlwaysAs(
      sql`((body ->> 'solar_system_id'))::integer`,
    ),
    // zKillboard's ISK estimate; not part of the ESI body, null when the writer had none.
    totalValue: doublePrecision('total_value'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('universe_killmail_killmail_time_idx').on(t.killmailTime),
    index('universe_killmail_system_time_idx').on(t.solarSystemId, t.killmailTime.desc()),
  ],
);
