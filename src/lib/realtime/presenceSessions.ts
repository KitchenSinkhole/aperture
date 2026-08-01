// No `import 'server-only'`: this module is reached from `wsServer.ts`, which
// the custom `server.ts` loads via tsx outside Next's bundler where the
// `server-only` shim doesn't resolve. Same precedent as `mapViewers.ts` /
// `wsConnections.ts`.
import { sql } from 'drizzle-orm';
import { apertureConfig } from '../../../aperture.config';
import { db } from '@/db/client';
import { getLogger } from '@/lib/log/logger';

const realtimeLog = getLogger('server');

/**
 * Opens (or adopts) a presence session for `characterId` — the durable,
 * WebSocket-lifetime-derived signal behind "was this pilot in Aperture"
 * (docs/plans/integration-presence.md). A single statement: a reconnect
 * within `PRESENCE_SESSION_GAP_MS` of the last-seen `ended_at` adopts the
 * still-open row (bumping `ended_at` to now) instead of opening a second one,
 * so intervals per character never overlap.
 *
 * Never throws into the socket handler: returns `null` if the character row
 * is gone (e.g. a stale session outliving a deleted character) or on any
 * write failure.
 */
export async function openPresenceSession(characterId: bigint): Promise<bigint | null> {
  try {
    const gapSeconds = Math.round(apertureConfig.PRESENCE_SESSION_GAP_MS / 1000);
    const result = await db.execute<{ id: string }>(sql`
      WITH adopted AS (
        UPDATE ap_character_presence SET ended_at = now()
        WHERE id = (
          SELECT id FROM ap_character_presence
          WHERE character_id = ${characterId}
            AND ended_at > now() - make_interval(secs => ${gapSeconds})
          ORDER BY started_at DESC LIMIT 1
        )
        RETURNING id
      ), inserted AS (
        INSERT INTO ap_character_presence (character_id, corporation_id)
        SELECT ${characterId}, c.corporation_id FROM ap_character c
        WHERE c.id = ${characterId} AND NOT EXISTS (SELECT 1 FROM adopted)
        RETURNING id
      )
      SELECT id FROM adopted UNION ALL SELECT id FROM inserted
    `);
    const row = result.rows[0];
    return row ? BigInt(row.id) : null;
  } catch (err) {
    realtimeLog.error('failed to open presence session', {
      characterId: characterId.toString(),
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Advances `ended_at = now()` on every listed session id in one statement.
 * This is also the **close** path — closing a socket is just the final touch,
 * so there is no separate close function. Never throws; a failure here must
 * not affect the socket it's attached to.
 */
export async function touchPresenceSessions(ids: bigint[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    await db.execute(sql`UPDATE ap_character_presence SET ended_at = now() WHERE id IN (${idList})`);
  } catch (err) {
    realtimeLog.error('failed to touch presence sessions', {
      count: ids.length,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
