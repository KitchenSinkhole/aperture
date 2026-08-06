import { bigint, bigserial, boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { apCharacter } from './character';
import { sharePresenceMode } from './enums';
import { apMap } from './map';

// One row per issued public share link (`/live/<token>`). A share is live
// when `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
// and the parent map is not soft-deleted — no `active` boolean per CLAUDE.md
// lifecycle rule. `token` is generated server-side (`generateShareToken`,
// src/lib/map/share.ts) and stored raw so it can be re-copied from the
// management dialog; unlike `ap_integration_token` this is a capability URL,
// not a bearer credential that must be unrecoverable after mint.
export const apMapShare = pgTable(
  'ap_map_share',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    mapId: bigint('map_id', { mode: 'bigint' })
      .notNull()
      .references(() => apMap.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    label: text('label').notNull(),
    presenceMode: sharePresenceMode('presence_mode').notNull().default('anonymous'),
    showSignatures: boolean('show_signatures').notNull().default(false),
    // Independent of `showSignatures` — the two endpoint sig IDs on an
    // already-visible wormhole disclose nothing about unscanned sigs.
    showConnectionSigIds: boolean('show_connection_sig_ids').notNull().default(false),
    // Bubbled connection ends. A bubble is a fleet's own doctrine call, so it
    // stays off unless the operator publishes it deliberately.
    showBubbles: boolean('show_bubbles').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByCharacterId: bigint('created_by_character_id', { mode: 'bigint' }).references(
      () => apCharacter.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ap_map_share_map_id_idx').on(t.mapId)],
);
