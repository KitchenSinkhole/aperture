import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapConnection, apMapSystem } from '@/db/schema';
import { commitMapEvent, type ActionResult } from './core';
import { addSystem } from './systems';
import type { MapEventPayload } from '@/lib/realtime/protocol';

/**
 * Restore a dormant wormhole connection — the Stage 4 sig-memory restore. A
 * `wh` connection goes dormant (`confirmed_at = NULL`, hidden from
 * `loadMapForView`) when one of its endpoints is removed, but the row keeps its
 * full observed WH state (type/mass/EOL/static) and the surviving signature
 * still points at it. When a paste re-confirms that sig, the client offers to
 * restore: re-confirm the connection and re-activate any hidden endpoint.
 *
 * Folds the work under one outer `db.transaction` (mirroring
 * `addSystemWithStargateLinks` / `deleteSubchain`) and returns the ordered
 * committed `MapEventPayload[]` — `system.added` for each re-activated endpoint
 * first, then `connection.create` — so the initiating client registers every
 * `eventId` and folds them like a bulk paste (the far node exists before the
 * edge). We never delete/recreate the row (that would cascade the sig and lose
 * the observed state); restore is a `confirmed_at = now()` flip + re-broadcast.
 *
 * Re-uses `connection.create` (not a new event kind) for the re-confirm — the
 * client reducer upserts by id, so a re-broadcast of an existing edge is an
 * idempotent no-op-then-replace.
 */

export type RestoreConnectionInput = {
  mapId: bigint;
  connectionId: bigint;
  characterId: bigint | null;
};

export type RestoreConnectionResult = {
  payloads: MapEventPayload[];
};

export async function restoreConnection(
  input: RestoreConnectionInput,
): Promise<ActionResult<RestoreConnectionResult>> {
  try {
    const result = await db.transaction(async (tx) => {
      const [conn] = await tx
        .select({
          id: apMapConnection.id,
          scope: apMapConnection.scope,
          source: apMapConnection.sourceMapSystemId,
          target: apMapConnection.targetMapSystemId,
        })
        .from(apMapConnection)
        .where(and(eq(apMapConnection.id, input.connectionId), eq(apMapConnection.mapId, input.mapId)));
      if (!conn) throw new Error('Connection not found.');
      // Only wormhole connections ever go dormant; structural links never do.
      if (conn.scope !== 'wh') throw new Error('Only wormhole connections can be restored.');

      const payloads: MapEventPayload[] = [];

      // Re-activate any hidden endpoint (the removed side). `addSystem` is
      // idempotent for an already-visible endpoint and keeps the prior position;
      // it rides Stage 1 so the re-activated system's surviving sigs come along.
      const endpoints = await tx
        .select({
          id: apMapSystem.id,
          systemId: apMapSystem.systemId,
          visible: apMapSystem.visible,
        })
        .from(apMapSystem)
        .where(
          and(
            eq(apMapSystem.mapId, input.mapId),
            inArray(apMapSystem.id, [conn.source, conn.target]),
          ),
        );
      for (const e of endpoints) {
        if (e.visible) continue;
        const res = await addSystem({
          mapId: input.mapId,
          systemId: e.systemId,
          characterId: input.characterId,
          tx,
        });
        if (!res.ok) throw new Error(res.error);
        payloads.push(res.data);
      }

      // Re-confirm the connection and re-broadcast its full edge body.
      const confirm = await commitMapEvent({
        mapId: input.mapId,
        characterId: input.characterId,
        kind: 'connection.create',
        tx,
        mutate: async (innerTx) => {
          const [row] = await innerTx
            .update(apMapConnection)
            .set({ confirmedAt: new Date() })
            .where(eq(apMapConnection.id, input.connectionId))
            .returning({
              id: apMapConnection.id,
              source: apMapConnection.sourceMapSystemId,
              target: apMapConnection.targetMapSystemId,
              scope: apMapConnection.scope,
              massStatus: apMapConnection.massStatus,
              jumpMassClass: apMapConnection.jumpMassClass,
              eolStage: apMapConnection.eolStage,
              preserveMass: apMapConnection.preserveMass,
              isRolling: apMapConnection.isRolling,
              isStatic: apMapConnection.isStatic,
              eolAt: apMapConnection.eolAt,
              createdAt: apMapConnection.createdAt,
            });
          if (!row) throw new Error('Connection not found.');
          return {
            id: row.id.toString(),
            source: row.source.toString(),
            target: row.target.toString(),
            scope: row.scope,
            massStatus: row.massStatus,
            jumpMassClass: row.jumpMassClass,
            eolStage: row.eolStage,
            preserveMass: row.preserveMass,
            isRolling: row.isRolling,
            isStatic: row.isStatic,
            eolAt: row.eolAt ? row.eolAt.toISOString() : null,
            createdAt: row.createdAt.toISOString(),
          };
        },
      });
      if (!confirm.ok) throw new Error(confirm.error);
      payloads.push(confirm.data);

      return { payloads };
    });

    return { ok: true, data: result, eventId: 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Restore connection failed.' };
  }
}
