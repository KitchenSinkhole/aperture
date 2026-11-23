import { and, eq, inArray, max } from 'drizzle-orm';
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
 * The single non-K162 code among `codes`; `K162` when that is the only code;
 * null when there is none or the non-K162 codes disagree.
 */
export function boundWormholeCode(codes: Iterable<string>): string | null {
  const distinct = new Set(codes);
  const real = [...distinct].filter((c) => c !== 'K162');
  if (real.length === 1) return real[0]!;
  if (real.length === 0 && distinct.has('K162')) return 'K162';
  return null;
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

  const boundCodes = await tx
    .select({ name: universeWormhole.name })
    .from(apMapSignature)
    .innerJoin(universeWormhole, eq(universeWormhole.typeId, apMapSignature.typeId))
    .where(eq(apMapSignature.mapConnectionId, input.connectionId));
  const removedCodes =
    input.removedBoundSigTypeIds && input.removedBoundSigTypeIds.length > 0
      ? await tx
          .select({ name: universeWormhole.name })
          .from(universeWormhole)
          .where(inArray(universeWormhole.typeId, input.removedBoundSigTypeIds))
      : [];

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
    wormholeCode: boundWormholeCode([...boundCodes, ...removedCodes].map((r) => r.name)),
  };
}
