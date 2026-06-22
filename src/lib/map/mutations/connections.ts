import 'server-only';
import { and, eq, type InferInsertModel } from 'drizzle-orm';
import { apMapConnection, connectionScope, eolStage, whJumpMass, whMass } from '@/db/schema';
import { commitMapEvent, type ActionResult, type Tx } from './core';
import type { MapEventPatch, MapEventPayload } from '@/lib/realtime/protocol';

/**
 * Connection-level map mutations (create / delete / update), each a single
 * `commitMapEvent` call. Unlike systems, connections are HARD-deleted on
 * collapse (CLAUDE.md: wormholes don't come back; attached signatures cascade).
 */

type ConnectionScope = (typeof connectionScope.enumValues)[number];
type WhMass = (typeof whMass.enumValues)[number];
type WhJumpMass = (typeof whJumpMass.enumValues)[number];
type EolStage = (typeof eolStage.enumValues)[number];

export type CreateConnectionInput = {
  mapId: bigint;
  characterId: bigint | null;
  sourceMapSystemId: bigint;
  targetMapSystemId: bigint;
  scope: ConnectionScope;
  massStatus?: WhMass;
  jumpMassClass?: WhJumpMass | null;
  eolStage?: EolStage;
  preserveMass?: boolean;
  isRolling?: boolean;
  isStatic?: boolean;
  /** Optional outer transaction (joined by `addSystemWithStargateLinks` to commit gate links atomically with the system add). */
  tx?: Tx;
};

export type DeleteConnectionInput = {
  mapId: bigint;
  connectionId: bigint;
  characterId: bigint | null;
  /** Optional outer transaction (joined by `bulkSignatures.ts` to tear down orphan WH connections atomically with sig deletes). */
  tx?: Tx;
};

/** Fields a client may change on a connection. Omitted keys are left untouched. */
export type UpdateConnectionPatch = {
  scope?: ConnectionScope;
  massStatus?: WhMass;
  jumpMassClass?: WhJumpMass | null;
  eolStage?: EolStage;
  preserveMass?: boolean;
  isRolling?: boolean;
  isStatic?: boolean;
};

export type UpdateConnectionInput = {
  mapId: bigint;
  connectionId: bigint;
  characterId: bigint | null;
  patch: UpdateConnectionPatch;
};

/** Create a connection between two map systems. Emits `connection.create` with the full edge body. */
export function createConnection(
  input: CreateConnectionInput,
): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'connection.create',
    tx: input.tx,
    mutate: async (tx) => {
      const stage = input.eolStage ?? 'none';
      const [row] = await tx
        .insert(apMapConnection)
        .values({
          mapId: input.mapId,
          sourceMapSystemId: input.sourceMapSystemId,
          targetMapSystemId: input.targetMapSystemId,
          scope: input.scope,
          massStatus: input.massStatus ?? 'fresh',
          jumpMassClass: input.jumpMassClass ?? null,
          eolStage: stage,
          preserveMass: input.preserveMass ?? false,
          isRolling: input.isRolling ?? false,
          isStatic: input.isStatic ?? false,
          eolAt: stage !== 'none' ? new Date() : null,
          // Every create is a fresh assertion (manual draw, sig link, stargate
          // auto-link) → confirmed now. removeSystem dormants wh rows by NULLing this.
          confirmedAt: new Date(),
        })
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
      return {
        id: row!.id.toString(),
        source: row!.source.toString(),
        target: row!.target.toString(),
        scope: row!.scope,
        massStatus: row!.massStatus,
        jumpMassClass: row!.jumpMassClass,
        eolStage: row!.eolStage,
        preserveMass: row!.preserveMass,
        isRolling: row!.isRolling,
        isStatic: row!.isStatic,
        eolAt: row!.eolAt ? row!.eolAt.toISOString() : null,
        createdAt: row!.createdAt.toISOString(),
      };
    },
  });
}

/** Hard-delete a connection (wormholes don't come back). Attached signatures cascade. Emits `connection.delete` → `{ id }`. */
export function deleteConnection(
  input: DeleteConnectionInput,
): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'connection.delete',
    tx: input.tx,
    mutate: async (tx) => {
      const [row] = await tx
        .delete(apMapConnection)
        .where(
          and(eq(apMapConnection.id, input.connectionId), eq(apMapConnection.mapId, input.mapId)),
        )
        .returning({
          id: apMapConnection.id,
          source: apMapConnection.sourceMapSystemId,
          target: apMapConnection.targetMapSystemId,
        });
      if (!row) throw new Error('Connection not found on map.');
      // Endpoints ride the payload so the audit/Discord can name the collapsed
      // hole — the connection row is gone after this delete.
      return { id: row.id.toString(), source: row.source.toString(), target: row.target.toString() };
    },
  });
}

/**
 * Update a connection's flags. Only keys present in `patch` change. Changing
 * `eolStage` re-stamps `eol_at` to *now* whenever the stage actually changes to
 * a non-`none` value (so the 1h `critical` window starts at the critical
 * observation, not the original 4h flag), preserves the existing stamp on a
 * repeat of the same stage, and clears it to null when set back to `none` —
 * this `eol_at` feeds the EOL-expiry cron. Emits `connection.update`.
 */
export function updateConnection(
  input: UpdateConnectionInput,
): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'connection.update',
    mutate: async (tx) => {
      const { patch } = input;
      const set: Partial<InferInsertModel<typeof apMapConnection>> = { updatedAt: new Date() };
      if ('scope' in patch) set.scope = patch.scope;
      if ('massStatus' in patch) set.massStatus = patch.massStatus;
      if ('jumpMassClass' in patch) set.jumpMassClass = patch.jumpMassClass;
      if ('preserveMass' in patch) set.preserveMass = patch.preserveMass;
      if ('isRolling' in patch) set.isRolling = patch.isRolling;
      if ('isStatic' in patch) set.isStatic = patch.isStatic;

      let nextEolAt: Date | null | undefined;
      if ('eolStage' in patch && patch.eolStage !== undefined) {
        const nextStage = patch.eolStage;
        set.eolStage = nextStage;
        if (nextStage === 'none') {
          nextEolAt = null;
        } else {
          const [cur] = await tx
            .select({ eolStage: apMapConnection.eolStage, eolAt: apMapConnection.eolAt })
            .from(apMapConnection)
            .where(
              and(
                eq(apMapConnection.id, input.connectionId),
                eq(apMapConnection.mapId, input.mapId),
              ),
            );
          // Re-stamp when the stage changes (e.g. eol → critical restarts the 1h
          // clock); keep the existing stamp when the same stage is re-applied.
          nextEolAt = cur && cur.eolStage === nextStage ? (cur.eolAt ?? new Date()) : new Date();
        }
        set.eolAt = nextEolAt;
      }

      const [row] = await tx
        .update(apMapConnection)
        .set(set)
        .where(
          and(eq(apMapConnection.id, input.connectionId), eq(apMapConnection.mapId, input.mapId)),
        )
        .returning({
          id: apMapConnection.id,
          source: apMapConnection.sourceMapSystemId,
          target: apMapConnection.targetMapSystemId,
        });
      if (!row) throw new Error('Connection not found on map.');

      // Endpoints ride every update so its audit entry self-describes even after
      // the connection is later hard-deleted.
      const out: MapEventPatch<'connection.update'> = {
        id: row.id.toString(),
        source: row.source.toString(),
        target: row.target.toString(),
      };
      if ('scope' in patch) out.scope = patch.scope;
      if ('massStatus' in patch) out.massStatus = patch.massStatus;
      if ('jumpMassClass' in patch) out.jumpMassClass = patch.jumpMassClass;
      if ('preserveMass' in patch) out.preserveMass = patch.preserveMass;
      if ('isRolling' in patch) out.isRolling = patch.isRolling;
      if ('isStatic' in patch) out.isStatic = patch.isStatic;
      if ('eolStage' in patch && patch.eolStage !== undefined) {
        out.eolStage = patch.eolStage;
        out.eolAt = nextEolAt ? nextEolAt.toISOString() : null;
      }
      return out;
    },
  });
}
