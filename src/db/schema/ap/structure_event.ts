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
import { intelScope, structureEventKind } from './enums';

// Append-only accountability log for manual structure intel
// (`ap_structure`). A structure is editable by people other than its creator, so
// every mutation is recorded here stamped with the acting character — that's how
// griefers are identified.
//
// Deliberately FK-less on `structure_id` / `system_id`: a `delete` record must
// survive the hard-delete of its `ap_structure` row (the row is gone, but the
// audit trail — including the full pre-delete snapshot in `payload` — must
// remain). Only `character_id` is a real FK, SET NULL on erase, matching the
// audit convention of `ap_map_event` and `ap_structure.created_by_character_id`.
export const apStructureEvent = pgTable(
  'ap_structure_event',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    structureId: bigint('structure_id', { mode: 'bigint' }).notNull(),
    systemId: integer('system_id').notNull(),
    characterId: bigint('character_id', { mode: 'bigint' }).references(() => apCharacter.id, {
      onDelete: 'set null',
    }),
    kind: structureEventKind('kind').notNull(),
    // The values written (create/update) or the full pre-delete row (delete).
    payload: jsonb('payload'),
    // The parent row's tenancy, denormalized at write time. `payload` holds the
    // full pre-delete snapshot, so an unscoped read of this table would return
    // exactly the intel the parent-table filter withholds — and on a delete the
    // parent is gone, so the scope cannot be derived by join at read time. Same
    // column semantics and CHECK as `ap_structure`.
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
    index('ap_structure_event_structure_id_idx').on(t.structureId),
    index('ap_structure_event_character_id_idx').on(t.characterId),
    index('ap_structure_event_scope_idx').on(
      t.scope,
      t.scopeCorporationId,
      t.scopeAllianceId,
      t.scopeCharacterId,
    ),
    check(
      'ap_structure_event_scope_matches_owner_chk',
      sql`(${t.scope} = 'private' and ${t.scopeCorporationId} is null and ${t.scopeAllianceId} is null)
          or (${t.scope} = 'corp' and ${t.scopeCharacterId} is null and ${t.scopeCorporationId} is not null and ${t.scopeAllianceId} is null)
          or (${t.scope} = 'alliance' and ${t.scopeCharacterId} is null and ${t.scopeCorporationId} is null and ${t.scopeAllianceId} is not null)`,
    ),
  ],
);
