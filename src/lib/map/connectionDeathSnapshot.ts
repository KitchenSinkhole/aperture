import { and, eq, inArray, max, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import {
  apMapConnection,
  apMapConnectionLog,
  apMapSignature,
  universeWormhole,
} from '@/db/schema';
import type { Tx } from '@/lib/map/mutations/core';
import type { ConnectionDeathCause, ConnectionDeathSnapshot } from '@/types';

// No `import 'server-only'`: the reaper crons (graphile-worker, bare tsx) share this reader.

export type ReadConnectionDeathSnapshotInput = {
  connectionId: bigint;
  mapId: bigint;
  cause: Exclude<ConnectionDeathCause, 'rolled'>;
  /**
   * `type_id`s of signatures that were bound to this connection but already
   * deleted earlier in the same transaction, folded into the `wormholeCode` rule.
   */
  removedBoundSigTypeIds?: number[];
};

/**
 * The bound-signature code rule as an aggregate over `code`, a column of
 * `universe_wormhole.name` values (one row per bound signature type): the
 * single distinct non-K162 code; `K162` when that is the only code; null when
 * there are no rows or the non-K162 codes disagree. Shared by the death
 * snapshot and the auto-EOL cron so both type a hole the same way.
 */
export function boundWormholeCodeSql(code: SQLWrapper): SQL<string | null> {
  return sql<string | null>`(case
    when count(distinct ${code}) filter (where ${code} <> 'K162') = 1
      then max(${code}) filter (where ${code} <> 'K162')
    when count(*) filter (where ${code} <> 'K162') = 0 and bool_or(${code} = 'K162')
      then 'K162'
  end)`;
}

/**
 * Read a connection's death snapshot. Must run on the transaction that deletes
 * the row, before the delete: the mass log and bound signatures cascade with it.
 * Returns null when no such connection is on the map.
 */
export async function readConnectionDeathSnapshot(
  tx: Tx,
  input: ReadConnectionDeathSnapshotInput,
): Promise<ConnectionDeathSnapshot | null> {
  const [conn] = await tx
    .select({
      createdAt: apMapConnection.createdAt,
      updatedAt: apMapConnection.updatedAt,
      confirmedAt: apMapConnection.confirmedAt,
      scope: apMapConnection.scope,
      massStatus: apMapConnection.massStatus,
      isRolling: apMapConnection.isRolling,
      isStatic: apMapConnection.isStatic,
      eolStage: apMapConnection.eolStage,
      eolAt: apMapConnection.eolAt,
      eolSource: apMapConnection.eolSource,
    })
    .from(apMapConnection)
    .where(and(eq(apMapConnection.id, input.connectionId), eq(apMapConnection.mapId, input.mapId)))
    .for('update');
  if (!conn) return null;

  const [log] = await tx
    .select({ lastJumpAt: max(apMapConnectionLog.jumpedAt) })
    .from(apMapConnectionLog)
    .where(eq(apMapConnectionLog.connectionId, input.connectionId));

  const boundTypeIds = tx
    .select({ typeId: apMapSignature.typeId })
    .from(apMapSignature)
    .where(eq(apMapSignature.mapConnectionId, input.connectionId));
  const removed = input.removedBoundSigTypeIds ?? [];
  const [bound] = await tx
    .select({ code: boundWormholeCodeSql(universeWormhole.name) })
    .from(universeWormhole)
    .where(
      removed.length > 0
        ? or(inArray(universeWormhole.typeId, boundTypeIds), inArray(universeWormhole.typeId, removed))
        : inArray(universeWormhole.typeId, boundTypeIds),
    );

  const aliveCandidates = [log?.lastJumpAt ?? null, conn.confirmedAt, conn.updatedAt]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());

  const rolled = conn.isRolling || conn.massStatus === 'critical';
  const cause: ConnectionDeathCause =
    input.cause === 'manual_removed' && rolled ? 'rolled' : input.cause;

  return {
    cause,
    bornAt: conn.createdAt.toISOString(),
    lastAliveAt: new Date(Math.max(...aliveCandidates)).toISOString(),
    scope: conn.scope,
    massStatus: conn.massStatus,
    isRolling: conn.isRolling,
    isStatic: conn.isStatic,
    eolStage: conn.eolStage,
    eolAt: conn.eolAt ? conn.eolAt.toISOString() : null,
    eolSource: conn.eolSource,
    wasDormant: conn.confirmedAt === null,
    wormholeCode: bound?.code ?? null,
  };
}
