import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { apertureConfig } from '../../../../aperture.config';
import { db } from '@/db/client';
import { apMap, apMapConnection } from '@/db/schema';
import { commitMapEvent } from '@/lib/map/mutations/core';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

/**
 * Expired-connection cron: delete `ap_map_connection` rows with
 * `scope IN ('wh', 'abyssal')` older than `WORMHOLE_DEFAULT_LIFETIME_MS` (48h —
 * the practical wormhole lifetime cap), but only on
 * maps where `ap_map.delete_expired_connections = true`. Each delete fires
 * through `commitMapEvent` so it becomes a `connection.delete` event.
 *
 * Shares the ms constant with the canvas "expires in X" hint so the
 * displayed lifetime and the actual reap threshold can't drift; the SQL
 * `make_interval(secs => …)` site converts ms → seconds.
 *
 * An abyssal trace outlives its pocket by even further than a wormhole outlives
 * its own lifetime — the filament is single-use and collapses in minutes — so
 * the shared 48h threshold is a generous upper bound rather than a modelled
 * lifetime. Without it a map that folds filament runs accretes an edge per run
 * with nothing to ever remove it.
 *
 * `stargate` and `jumpbridge` are structural and never expire on age alone.
 */

const NAME = 'expired-connections';

async function expire(): Promise<{ scanned: number; deleted: number; failed: number }> {
  const candidates = await db
    .select({
      connectionId: apMapConnection.id,
      mapId: apMapConnection.mapId,
    })
    .from(apMapConnection)
    .innerJoin(apMap, eq(apMapConnection.mapId, apMap.id))
    .where(
      and(
        inArray(apMapConnection.scope, ['wh', 'abyssal']),
        lt(
          apMapConnection.createdAt,
          sql`now() - make_interval(secs => ${apertureConfig.WORMHOLE_DEFAULT_LIFETIME_MS / 1000})`,
        ),
        eq(apMap.deleteExpiredConnections, true),
        isNull(apMap.deletedAt),
      ),
    )
    .limit(apertureConfig.JOB_DELETE_BATCH_SIZE);

  let deleted = 0;
  let failed = 0;
  for (const row of candidates) {
    const result = await commitMapEvent({
      mapId: row.mapId,
      characterId: null,
      kind: 'connection.delete',
      mutate: async (tx) => {
        const [del] = await tx
          .delete(apMapConnection)
          .where(eq(apMapConnection.id, row.connectionId))
          .returning({
            id: apMapConnection.id,
            source: apMapConnection.sourceMapSystemId,
            target: apMapConnection.targetMapSystemId,
          });
        if (!del) throw new Error('Connection already gone.');
        return {
          id: del.id.toString(),
          source: del.source.toString(),
          target: del.target.toString(),
        };
      },
    });
    if (result.ok) deleted += 1;
    else failed += 1;
  }

  return { scanned: candidates.length, deleted, failed };
}

export const expiredConnections: JobModule = {
  name: NAME,
  cron: '0 * * * *',
  run: withInstrumentation(NAME, expire),
};
