import { bigint, bigserial, check, index, pgTable, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { apCharacter } from './character';

// One row per contiguous stretch a character's WebSocket was connected
// (docs/plans/integration-presence.md). "Online in Aperture" means the app is
// open in a browser tab — this says nothing about EVE-onlineness. Written by
// src/lib/realtime/presenceSessions.ts from the socket lifecycle in wsServer.ts.
export const apCharacterPresence = pgTable(
  'ap_character_presence',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    characterId: bigint('character_id', { mode: 'bigint' })
      .notNull()
      .references(() => apCharacter.id, { onDelete: 'cascade' }),
    // Snapshot of ap_character.corporation_id taken when the session opens — the
    // tenant boundary the integration reader filters on. Nullable because the
    // source column is nullable; a null-corp row is invisible to every token.
    corporationId: bigint('corporation_id', { mode: 'bigint' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ap_character_presence_character_idx').on(t.characterId, t.startedAt.desc()),
    index('ap_character_presence_corp_idx').on(t.corporationId, t.startedAt.desc()),
    check('ap_character_presence_interval_ck', sql`${t.endedAt} >= ${t.startedAt}`),
  ],
);
