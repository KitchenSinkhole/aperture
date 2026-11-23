import { and, eq, isNull, not, sql } from 'drizzle-orm';
import { apertureConfig } from '../../../../aperture.config';
import { db } from '@/db/client';
import { apMap, apMapConnection } from '@/db/schema';
import { readConnectionDeathSnapshot } from '@/lib/map/connectionDeathSnapshot';
import { commitMapEvent } from '@/lib/map/mutations/core';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

/**
 * EOL-expiry cron: delete `ap_map_connection` rows that have been
 * end-of-life (`eol_stage <> 'none'`) for longer than the lifetime of their
 * *current* stage — `WORMHOLE_EOL_LIFETIME_MS` (4h 36m) for the `eol` stage,
 * `WORMHOLE_EOL_CRITICAL_LIFETIME_MS` (1h 15m) for the `critical` stage,
 * `WORMHOLE_EXPIRED_LIFETIME_MS` (4h) for the manual `expired` stage (measured
 * from `eol_at`, the moment a scout flagged it) — but only on maps where
 * `ap_map.delete_eol_connections = true`. Each delete fires through
 * `commitMapEvent` so it becomes a `connection.delete` event on the realtime bus.
 *
 * Shares the ms constants with the canvas EOL countdown so the
 * "expires in X" hint and the actual reap threshold can never drift apart; the
 * SQL `make_interval(secs => …)` site converts ms → seconds and picks the
 * per-stage constant with a `CASE` so a hole escalated to `critical` is reaped
 * on the 1h clock that started at its critical observation.
 *
 * Connections are hard-deleted (CLAUDE.md: wormholes don't come back); attached
 * `ap_map_signature` rows cascade.
 */

const NAME = 'eol-expiry';

function reapDue() {
  return and(
    not(eq(apMapConnection.eolStage, 'none')),
    // eol_at is null until the stage leaves 'none'; skip races where the
    // stage is set but no stamp landed yet.
    not(isNull(apMapConnection.eolAt)),
    // The CASE branches are bound params (unknown → text), so the CASE result
    // is text; cast it to double precision for make_interval's `secs` arg.
    sql`${apMapConnection.eolAt} < now() - make_interval(secs => (case when ${apMapConnection.eolStage} = 'critical' then ${
      apertureConfig.WORMHOLE_EOL_CRITICAL_LIFETIME_MS / 1000
    } when ${apMapConnection.eolStage} = 'expired' then ${
      apertureConfig.WORMHOLE_EXPIRED_LIFETIME_MS / 1000
    } else ${apertureConfig.WORMHOLE_EOL_LIFETIME_MS / 1000} end)::double precision)`,
  );
}

async function expireEol(): Promise<{ scanned: number; deleted: number; failed: number }> {
  const candidates = await db
    .select({
      connectionId: apMapConnection.id,
      mapId: apMapConnection.mapId,
    })
    .from(apMapConnection)
    .innerJoin(apMap, eq(apMapConnection.mapId, apMap.id))
    .where(
      and(reapDue(), eq(apMap.deleteEolConnections, true), isNull(apMap.deletedAt)),
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
        const snapshot = await readConnectionDeathSnapshot(tx, {
          connectionId: row.connectionId,
          mapId: row.mapId,
          cause: 'eol_reaped',
        });
        if (!snapshot) throw new Error('Connection already gone.');
        // Re-checked under the snapshot's row lock, so a scout's confirm or
        // clear since the candidate select keeps the hole.
        const [del] = await tx
          .delete(apMapConnection)
          .where(and(eq(apMapConnection.id, row.connectionId), reapDue()))
          .returning({
            id: apMapConnection.id,
            source: apMapConnection.sourceMapSystemId,
            target: apMapConnection.targetMapSystemId,
          });
        if (!del) throw new Error('Connection no longer due.');
        return {
          id: del.id.toString(),
          source: del.source.toString(),
          target: del.target.toString(),
          ...snapshot,
        };
      },
    });
    if (result.ok) deleted += 1;
    else failed += 1;
  }

  return { scanned: candidates.length, deleted, failed };
}

export const eolExpiry: JobModule = {
  name: NAME,
  cron: '*/5 * * * *',
  run: withInstrumentation(NAME, expireEol),
};
