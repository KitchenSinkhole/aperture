import { bigint, bigserial, boolean, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { universeSystem } from '../universe/geography';
import { apMap } from './map';
import { apUser } from './user';

/** Per-map route favourite (personal or shared within the map). */
export const apMapRouteFavourite = pgTable(
  'ap_map_route_favourite',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    mapId: bigint('map_id', { mode: 'bigint' })
      .notNull()
      .references(() => apMap.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => apUser.id, { onDelete: 'cascade' }),
    systemId: integer('system_id')
      .notNull()
      .references(() => universeSystem.id, { onDelete: 'restrict' }),
    label: text('label'),
    shared: boolean('shared').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('ap_map_route_favourite_map_user_system_key').on(t.mapId, t.userId, t.systemId)],
);
