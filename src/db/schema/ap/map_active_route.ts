import { bigint, bigserial, integer, jsonb, pgTable, timestamp } from 'drizzle-orm/pg-core';
import { universeSystem } from '../universe/geography';
import { apCharacter } from './character';
import { apMap } from './map';
import { apUser } from './user';

/** Experimental active route session — owner-only visibility; followers embedded. */
export const apMapActiveRoute = pgTable('ap_map_active_route', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  mapId: bigint('map_id', { mode: 'bigint' })
    .notNull()
    .references(() => apMap.id, { onDelete: 'cascade' }),
  ownerUserId: integer('owner_user_id')
    .notNull()
    .references(() => apUser.id, { onDelete: 'cascade' }),
  primaryCharacterId: bigint('primary_character_id', { mode: 'bigint' })
    .notNull()
    .references(() => apCharacter.id, { onDelete: 'cascade' }),
  destinationSystemId: integer('destination_system_id')
    .notNull()
    .references(() => universeSystem.id, { onDelete: 'restrict' }),
  /** Serialised `RouteHop[]` + metadata for reroute. */
  planJson: jsonb('plan_json').notNull(),
  /** EVE character ids following this route (includes primary). */
  followerCharacterIds: jsonb('follower_character_ids').$type<number[]>().notNull().default([]),
  waypointCursor: integer('waypoint_cursor').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
