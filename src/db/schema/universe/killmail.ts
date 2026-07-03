import { bigint, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Persistent cache of full ESI killmails referenced by the system-killboard feed.
// zKillboard's per-system list only returns `{ killmailId, hash }`, so the victim,
// ship, kill time, and attacker count come from a `getKillmail` fetch against the
// shared app-wide (unauthenticated) ESI rate-limit bucket. Killmail bodies are
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
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('universe_killmail_killmail_time_idx').on(t.killmailTime)],
);
