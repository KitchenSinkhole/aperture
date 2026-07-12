import { bigint, bigserial, index, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { apCharacter } from './character';
import { apCorporation } from './corporation';
import { mapCapability, roleSource } from './enums';
import { apMap } from './map';

// The three tag-role tables.
//
// `ap_role` is the canonical role registry. Built-in roles live alongside
// roles mirrored from EVE corporation titles (one per `(corp, title_id)`) and
// roles synced from external systems (Discord, etc.). The `(source,
// external_ref)` pair is the upstream identity and is unique.
//
// `ap_character_role` is the character ↔ role membership join. `corp_title`
// rows are owned by `syncCharacterAuthz` (insert when ESI returns the title,
// delete when it disappears). Built-in / external rows are managed by their
// respective sync paths.
//
// `ap_map_role_access` is the per-map grant — any character holding any of
// the roles linked here has view access on the map. Mutation authority is the
// derived `canManageMap` (owner / corp Director / executor-corp Director /
// admin); roles do not grant mutation by themselves (see `src/lib/auth/rights.ts`).
export const apRole = pgTable(
  'ap_role',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    source: roleSource('source').notNull(),
    /**
     * Upstream identity. For `corp_title`, `'<corporation_id>:<title_id>'`.
     * For `external`, the third-party role id. NULL for `builtin` rows.
     */
    externalRef: text('external_ref'),
    name: text('name').notNull(),
    /** Optional human-friendly label; falls back to `name` in the UI. */
    displayLabel: text('display_label'),
    /**
     * Scopes a `corp_title` row to its issuing corp. NULL for `builtin` and
     * `external` roles (which apply globally).
     */
    corporationId: bigint('corporation_id', { mode: 'bigint' }).references(
      () => apCorporation.id,
      { onDelete: 'cascade' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ap_role_source_external_ref_uq').on(t.source, t.externalRef),
    index('ap_role_corporation_id_idx').on(t.corporationId),
  ],
);

export const apCharacterRole = pgTable(
  'ap_character_role',
  {
    characterId: bigint('character_id', { mode: 'bigint' })
      .notNull()
      .references(() => apCharacter.id, { onDelete: 'cascade' }),
    roleId: bigint('role_id', { mode: 'bigint' })
      .notNull()
      .references(() => apRole.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Free-form provenance string. Conventions:
     *   `'corp-title-sync'` — written by `syncCharacterAuthz`.
     *   `'<character_id>'`  — hand-granted by an admin via the admin UI.
     *   `'discord-sync'`    — written by the (future) Discord sync job.
     */
    grantedBy: text('granted_by'),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.roleId], name: 'ap_character_role_pk' }),
    index('ap_character_role_role_id_idx').on(t.roleId),
  ],
);

export const apMapRoleAccess = pgTable(
  'ap_map_role_access',
  {
    mapId: bigint('map_id', { mode: 'bigint' })
      .notNull()
      .references(() => apMap.id, { onDelete: 'cascade' }),
    roleId: bigint('role_id', { mode: 'bigint' })
      .notNull()
      .references(() => apRole.id, { onDelete: 'cascade' }),
    capability: mapCapability('capability').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.mapId, t.roleId, t.capability], name: 'ap_map_role_access_pk' }),
    index('ap_map_role_access_role_id_idx').on(t.roleId),
  ],
);
