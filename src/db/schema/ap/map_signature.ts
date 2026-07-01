import {
  bigint,
  bigserial,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { universeType } from '../universe/items';
import { apMapConnection } from './map_connection';
import { apMapSystem } from './map_system';
import { signatureClassKind, signatureGroupKey } from './enums';

// An in-game scan signature inside a system, optionally bound to the
// connection it resolves to (the wormhole itself). Reaped by the signature-reap
// cron on `expires_at`. Sigs bound to a connection cascade-delete when it
// collapses; unattached sigs (gas/ore/data/relic) survive system invisibility.
//
// `group_key` is the scanner-level group (one of the seven cosmic groups).
// `type_id` is only meaningful when `group_key = 'wormhole'`, where it points
// to a `universe_wormhole` row (resolved via `universe_type.id`). For the six
// cosmic groups the `name` column carries the EVE-emitted site name string
// (e.g. "Forgotten Perimeter Habitation Coils"), which is not in the SDE.
export const apMapSignature = pgTable(
  'ap_map_signature',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    mapSystemId: bigint('map_system_id', { mode: 'bigint' })
      .notNull()
      .references(() => apMapSystem.id, { onDelete: 'cascade' }),
    mapConnectionId: bigint('map_connection_id', { mode: 'bigint' }).references(
      () => apMapConnection.id,
      { onDelete: 'cascade' },
    ),
    // In-game 3-char id, e.g. "ABC".
    sigId: text('sig_id').notNull(),
    groupKey: signatureGroupKey('group_key'),
    // Signature vs anomaly. Paste-derived
    // only; nullable for legacy/manual rows whose kind was never observed.
    classKind: signatureClassKind('class_kind'),
    typeId: integer('type_id').references(() => universeType.id, { onDelete: 'set null' }),
    name: text('name'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('ap_map_signature_system_sig_uq').on(t.mapSystemId, t.sigId)],
);
