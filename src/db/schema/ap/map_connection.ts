import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, pgTable, timestamp } from 'drizzle-orm/pg-core';
import { connectionScope, eolStage, whJumpMass, whMass } from './enums';
import { apMap } from './map';
import { apMapSystem } from './map_system';

// A link between two systems on a map, modelled as typed columns + enums.
// Connections are hard-deleted on collapse (wormholes don't come back);
// attached signatures cascade.
export const apMapConnection = pgTable(
  'ap_map_connection',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    mapId: bigint('map_id', { mode: 'bigint' })
      .notNull()
      .references(() => apMap.id, { onDelete: 'cascade' }),
    sourceMapSystemId: bigint('source_map_system_id', { mode: 'bigint' })
      .notNull()
      .references(() => apMapSystem.id, { onDelete: 'cascade' }),
    targetMapSystemId: bigint('target_map_system_id', { mode: 'bigint' })
      .notNull()
      .references(() => apMapSystem.id, { onDelete: 'cascade' }),
    scope: connectionScope('scope').notNull(),
    massStatus: whMass('mass_status').notNull().default('fresh'),
    // Nullable: only wormhole links carry a jump-mass class.
    jumpMassClass: whJumpMass('jump_mass_class'),
    // Two-stage EOL: `eol` (~4h warning) and `critical` (~1h final). `none` =
    // not yet decaying. Selects the lifetime the countdown / reap use.
    eolStage: eolStage('eol_stage').notNull().default('none'),
    preserveMass: boolean('preserve_mass').notNull().default(false),
    isRolling: boolean('is_rolling').notNull().default(false),
    // User-designated "this wormhole is the source system's static". A free
    // manual flag (no catalog validation): the home system's static target can
    // be exempted from the ABC auto-tag (see `ap_map.exempt_home_static_from_tag`).
    isStatic: boolean('is_static').notNull().default(false),
    // When the *current* `eol_stage` was entered (re-stamped on each stage
    // change) — used by the EOL-expiry cron and the countdown.
    eolAt: timestamp('eol_at', { withTimezone: true }),
    // "Confirmed by a current sig observation." Defaults to now() so every insert
    // path is confirmed on create (not just `createConnection` — the location-poll
    // auto-link, Thera ingest, and transfer rely on this default); NULLed on a
    // `wh` connection when an endpoint system is removed (dormant memory — kept
    // for an in-place restore, hidden from the view). `loadMapForView` loads only
    // rows with a non-null `confirmed_at`. Non-`wh` rows are never dormanted.
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ap_map_connection_no_self_loop',
      sql`${t.sourceMapSystemId} <> ${t.targetMapSystemId}`,
    ),
  ],
);
