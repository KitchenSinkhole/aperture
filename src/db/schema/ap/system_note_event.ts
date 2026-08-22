import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
} from 'drizzle-orm/pg-core';
import { apCharacter } from './character';
import { intelScope, systemNoteEventKind } from './enums';

// Append-only accountability log for global system notes (`ap_system_note`).
// A note is editable by anyone its scope admits, not only its creator, so every
// mutation is recorded here stamped with the acting character — that's how
// griefers are identified.
//
// Deliberately FK-less on `note_id` / `system_id`: a `delete` record must
// survive the hard-delete of its `ap_system_note` row (the row is gone, but the
// audit trail — including the full pre-delete snapshot in `payload` — must
// remain). Only `character_id` is a real FK, SET NULL on erase, matching the
// audit convention of `ap_map_event` and `ap_system_note.created_by_character_id`.
//
// The `scope` triple is denormalized at write time: the payload holds the full
// pre-delete snapshot, so an unscoped read of this table would return exactly
// the intel the parent filter withholds — and a `delete` event cannot derive
// its scope from a parent row that is already gone.
export const apSystemNoteEvent = pgTable(
  'ap_system_note_event',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    noteId: bigint('note_id', { mode: 'bigint' }).notNull(),
    systemId: integer('system_id').notNull(),
    characterId: bigint('character_id', { mode: 'bigint' }).references(() => apCharacter.id, {
      onDelete: 'set null',
    }),
    kind: systemNoteEventKind('kind').notNull(),
    // The values written (create/update) or the full pre-delete row (delete).
    payload: jsonb('payload'),
    scope: intelScope('scope').notNull(),
    scopeCharacterId: bigint('scope_character_id', { mode: 'bigint' }).references(
      () => apCharacter.id,
      { onDelete: 'set null' },
    ),
    scopeCorporationId: bigint('scope_corporation_id', { mode: 'bigint' }),
    scopeAllianceId: bigint('scope_alliance_id', { mode: 'bigint' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ap_system_note_event_note_id_idx').on(t.noteId),
    index('ap_system_note_event_character_id_idx').on(t.characterId),
    index('ap_system_note_event_scope_idx').on(
      t.scope,
      t.scopeCorporationId,
      t.scopeAllianceId,
      t.scopeCharacterId,
    ),
    check(
      'ap_system_note_event_scope_matches_owner_chk',
      sql`(${t.scope} = 'private' and ${t.scopeCorporationId} is null and ${t.scopeAllianceId} is null)
          or (${t.scope} = 'corp' and ${t.scopeCharacterId} is null and ${t.scopeCorporationId} is not null and ${t.scopeAllianceId} is null)
          or (${t.scope} = 'alliance' and ${t.scopeCharacterId} is null and ${t.scopeCorporationId} is null and ${t.scopeAllianceId} is not null)`,
    ),
  ],
);
