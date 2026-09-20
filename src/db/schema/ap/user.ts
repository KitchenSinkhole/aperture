import { bigint, boolean, integer, jsonb, pgTable, timestamp } from 'drizzle-orm/pg-core';
import type { MapLayoutConfig } from '@/types';
import { routeSafety, whJumpMass } from './enums';

// Auth principal: a user owns one or more characters. One user is created per
// newly-seen character; additional characters can be linked onto an existing
// user. Kept deliberately minimal — identity lives on the character rows.
export const apUser = pgTable('ap_user', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  // The account's "main" character — the human identity that login
  // lands on and that statistics / activity roll up to. FK to ap_character is
  // declared in migration 0018 (an inline `.references()` here would create a
  // circular schema import: character.ts already imports apUser).
  mainCharacterId: bigint('main_character_id', { mode: 'bigint' }),
  // Per-account toggle for the connection travel animation (a subtle moving dot
  // along a connection when a tracked pilot jumps across it). On by default.
  connectionTravelAnimation: boolean('connection_travel_animation').notNull().default(true),
  // map-layout-builder: the account's free-form map dashboard arrangement — one
  // global layout applied to every map this user opens. Nullable; NULL ⇒ the
  // client falls back to DEFAULT_MAP_LAYOUT (no per-account row is seeded).
  mapLayout: jsonb('map_layout').$type<MapLayoutConfig>(),
  // Stale/unscanned signature indicators (per-account). The stale threshold is a
  // personal override of the global `ap_instance.stale_signature_threshold_minutes`:
  // NULL ⇒ use the global default; a non-null value is capped at the global on
  // write (a user may only make themselves *more* eager, never ignore the corp
  // default by setting a larger value). The two booleans toggle each indicator.
  staleSignatureThresholdMinutes: integer('stale_signature_threshold_minutes'),
  showStaleSignatureIndicator: boolean('show_stale_signature_indicator')
    .notNull()
    .default(true),
  showUnscannedSignatureIndicator: boolean('show_unscanned_signature_indicator')
    .notNull()
    .default(true),
  // routes-module: per-account route-planner settings. Personal config (not map
  // data), applied to every map. `routeSafety` follows EVE autopilot semantics;
  // `routeMinShipClass` NULL ⇒ no minimum (any hole passes); the three avoid
  // toggles exclude reduced/critical-mass and EOL wormholes; `routeIncludeEveScout`
  // folds the public EVE-Scout Thera/Turnur network into the routed graph.
  routeSafety: routeSafety('route_safety').notNull().default('shortest'),
  routeMinShipClass: whJumpMass('route_min_ship_class'),
  routeAvoidReduced: boolean('route_avoid_reduced').notNull().default(false),
  routeAvoidCritical: boolean('route_avoid_critical').notNull().default(false),
  routeAvoidEol: boolean('route_avoid_eol').notNull().default(false),
  routeIncludeEveScout: boolean('route_include_eve_scout').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
