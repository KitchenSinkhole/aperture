import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { universeSystem } from '../universe/geography';
import { universeType } from '../universe/items';
import { universeCorporation } from '../universe/corporation';
import { apCharacter } from './character';
import { intelScope } from './enums';

// Manual structure-intel: one row per
// player-owned structure a user has spotted in a system. Rows are system-scoped,
// not map-scoped: a row carries no `map_id` and surfaces on every map showing
// its system. Who may see it is the separate `scope` + `scope_*` triple below.
//
// This is MANUAL ENTRY, not ESI-resolved. ESI's getUniverseStructure only
// returns structures the calling character can dock at (their own corp's), so
// it can never supply intel on other corps' structures — which is the whole
// point of the feature. The structure *type* is static SDE data and therefore
// a real FK; the structure identity/owner are user-supplied notes.
//
// `owner_corporation_id` is the EVE corporation picked from the ESI search in the
// add/edit dialog, FK → `universe_corporation` (the corp name cache) so the owner
// resolves to a real corp and its name has a single source of truth (the cache
// row). It deliberately does NOT point at `ap_corporation`: that table is limited
// to *member* corps for the rights matrix, and a structure owner is usually a
// corp no member belongs to. Null when the owner is unknown.
export const apStructure = pgTable(
  'ap_structure',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    systemId: integer('system_id')
      .notNull()
      .references(() => universeSystem.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    structureTypeId: integer('structure_type_id')
      .notNull()
      .references(() => universeType.id, { onDelete: 'restrict' }),
    ownerCorporationId: bigint('owner_corporation_id', { mode: 'bigint' }).references(
      () => universeCorporation.id,
      { onDelete: 'restrict' },
    ),
    notes: text('notes'),
    // Tenancy. `scope` and exactly one `scope_*` column say who may read and
    // mutate this row; they are derived from the map it was written on, never
    // from the writer's own affiliation. Distinct from `owner_corporation_id`
    // above, which is the citadel's in-game owner and carries no visibility
    // meaning at all.
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ap_structure_system_id_idx').on(t.systemId),
    // Per-viewer visibility filter: `scope` partitions by branch, the entity id
    // then selects the viewer's own rows.
    index('ap_structure_scope_idx').on(
      t.scope,
      t.scopeCorporationId,
      t.scopeAllianceId,
      t.scopeCharacterId,
    ),
    check(
      'ap_structure_scope_matches_owner_chk',
      sql`(${t.scope} = 'private' and ${t.scopeCorporationId} is null and ${t.scopeAllianceId} is null)
          or (${t.scope} = 'corp' and ${t.scopeCharacterId} is null and ${t.scopeCorporationId} is not null and ${t.scopeAllianceId} is null)
          or (${t.scope} = 'alliance' and ${t.scopeCharacterId} is null and ${t.scopeCorporationId} is null and ${t.scopeAllianceId} is not null)`,
    ),
  ],
);
