import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { universeSystem } from '../universe/geography';
import { apCharacter } from './character';
import { intelScope } from './enums';

// Global system notes: free-text intel entries on a universe system. Keyed on
// the static system alone — unlike `ap_map_system.intel_notes`, a note here is
// readable from any map, any time the system is encountered again. A journal,
// not a single blob: each entry keeps its own author and timestamps.
//
// Carries no `map_id`, but is not deployment-global: the `scope` triple
// (mirroring `ap_structure`) names who may read and mutate the row, derived
// from the map it was written on, never from the writer's own affiliation.
export const apSystemNote = pgTable(
  'ap_system_note',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    systemId: integer('system_id')
      .notNull()
      .references(() => universeSystem.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    // Null ⇒ uncategorized (no chip in the panel). Plain text, not a pgEnum:
    // the vocabulary is a per-deployment instance setting
    // (`ap_instance.system_note_categories`), validated at the API boundary; a
    // stored value absent from the current vocabulary renders as a neutral chip.
    category: text('category'),
    // A locked note refuses edit/delete server-side until unlocked. Anyone the
    // row's scope admits may unlock — a guard rail against accidents, not
    // malice; the audit log covers malice.
    locked: boolean('locked').notNull().default(false),
    // Tenancy. `scope` and exactly one `scope_*` column say who may read and
    // mutate this row; they are derived from the map it was written on, never
    // from the writer's own affiliation.
    //   scope='private'  → scope_character_id   NOT NULL; other two NULL
    //   scope='corp'     → scope_corporation_id NOT NULL; other two NULL
    //   scope='alliance' → scope_alliance_id    NOT NULL; other two NULL
    // `scope_character_id` is `ON DELETE SET NULL`, so an erased character
    // leaves a `private` row with no owner at all; such a row is admin-only,
    // the same defensive default `canViewMap` applies to an unowned map.
    // `scope_corporation_id`/`scope_alliance_id` are bare bigints —
    // `ap_corporation`/`ap_alliance` are not FK targets app-wide.
    scope: intelScope('scope').notNull(),
    scopeCharacterId: bigint('scope_character_id', { mode: 'bigint' }).references(
      () => apCharacter.id,
      { onDelete: 'set null' },
    ),
    scopeCorporationId: bigint('scope_corporation_id', { mode: 'bigint' }),
    scopeAllianceId: bigint('scope_alliance_id', { mode: 'bigint' }),
    // Audit only — erasing a character must not cascade-wipe gathered intel.
    createdByCharacterId: bigint('created_by_character_id', { mode: 'bigint' }).references(
      () => apCharacter.id,
      { onDelete: 'set null' },
    ),
    lastEditedByCharacterId: bigint('last_edited_by_character_id', { mode: 'bigint' }).references(
      () => apCharacter.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ap_system_note_system_id_idx').on(t.systemId),
    // Per-viewer visibility filter: `scope` partitions by branch, the entity id
    // then selects the viewer's own rows.
    index('ap_system_note_scope_idx').on(
      t.scope,
      t.scopeCorporationId,
      t.scopeAllianceId,
      t.scopeCharacterId,
    ),
    check(
      'ap_system_note_scope_matches_owner_chk',
      sql`(${t.scope} = 'private' and ${t.scopeCorporationId} is null and ${t.scopeAllianceId} is null)
          or (${t.scope} = 'corp' and ${t.scopeCharacterId} is null and ${t.scopeCorporationId} is not null and ${t.scopeAllianceId} is null)
          or (${t.scope} = 'alliance' and ${t.scopeCharacterId} is null and ${t.scopeCorporationId} is null and ${t.scopeAllianceId} is not null)`,
    ),
  ],
);
