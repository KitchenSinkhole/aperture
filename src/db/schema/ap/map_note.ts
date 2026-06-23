import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { apCharacter } from './character';
import { mapNoteSeverity } from './enums';
import { apMap } from './map';

// A free-standing note placed on a map — movable/lockable like a system node,
// but referencing no static universe data. Notes replace the old "rename an
// inaccessible Jovian system" hack for broadcasting map-wide intel. Hard-deleted
// (a note has no natural re-add key), so there is no `visible` soft-delete flag.
//
// Attribution is denormalized onto the row (created/last-edited character) — a
// deliberate, documented deviation from the systems pattern (which keeps actor
// identity only in `ap_map_event`); the note UI must surface creator + last
// editor on selection and a jsonb-id audit scan would be awkward. The
// append-only audit trail still lands in `ap_map_event` like every mutation.
export const apMapNote = pgTable(
  'ap_map_note',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    mapId: bigint('map_id', { mode: 'bigint' })
      .notNull()
      .references(() => apMap.id, { onDelete: 'cascade' }),
    positionX: doublePrecision('position_x').notNull().default(0),
    positionY: doublePrecision('position_y').notNull().default(0),
    // ≤MAP_NOTE_TITLE_MAX_LENGTH enforced app-layer (Zod); the on-node label.
    title: text('title').notNull(),
    // Nullable longer free-form body, ≤MAP_NOTE_CONTENT_MAX_LENGTH app-layer.
    content: text('content'),
    severity: mapNoteSeverity('severity').notNull().default('neutral'),
    locked: boolean('locked').notNull().default(false),
    // SET NULL: erasing a character must not cascade-wipe the note.
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
  (t) => [index('ap_map_note_map_id_idx').on(t.mapId)],
);
