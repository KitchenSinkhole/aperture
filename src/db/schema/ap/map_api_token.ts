import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { apCharacter } from './character';
import { apiScope, apiTokenRevokeReason } from './enums';
import { apMap } from './map';
import { apUser } from './user';

// One row per per-map user API bearer token. Only the sha256 hex digest of the
// raw token is stored; the raw value is shown once at mint and is unrecoverable.
// A token is live when `revoked_at IS NULL AND (expires_at IS NULL OR
// expires_at > now())`. Revocation sets `revoked_at`, never a row delete.
//
// `user_id` is the owning account and the token's authority (not an audit
// column), so the token goes with the account. `revoked_by_character_id` is
// audit, so it is SET NULL.
export const apMapApiToken = pgTable(
  'ap_map_api_token',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    mapId: bigint('map_id', { mode: 'bigint' })
      .notNull()
      .references(() => apMap.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => apUser.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    label: text('label').notNull(),
    scopes: apiScope('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Usage counters, written in batches; approximate by design.
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    requestCount: bigint('request_count', { mode: 'bigint' }).notNull().default(sql`0`),
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    strikeCount: integer('strike_count').notNull().default(0),
    lastStrikeAt: timestamp('last_strike_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: apiTokenRevokeReason('revoked_reason'),
    revokedByCharacterId: bigint('revoked_by_character_id', { mode: 'bigint' }).references(
      () => apCharacter.id,
      { onDelete: 'set null' },
    ),
  },
  (t) => [
    index('ap_map_api_token_map_id_idx').on(t.mapId),
    index('ap_map_api_token_user_id_idx').on(t.userId),
  ],
);
