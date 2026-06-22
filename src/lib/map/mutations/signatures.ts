import 'server-only';
import { and, eq, type InferInsertModel } from 'drizzle-orm';
import { apMapConnection, apMapSignature, apMapSystem, universeWormhole } from '@/db/schema';
import { commitMapEvent, type ActionResult, type Tx } from './core';
import type { MapEventPatch, MapEventPayload } from '@/lib/realtime/protocol';
import type { SignatureGroupKey } from '@/types';

/**
 * Signature-level map mutations, each a single `commitMapEvent` call.
 * Signatures are hard-deleted (no soft-delete lifecycle): when a sig is
 * removed from the in-game scanner it's gone. Sigs bound to a connection
 * cascade-delete when that connection collapses.
 *
 * `apMapSignature` has no direct `map_id` column — ownership is validated
 * through `apMapSystem.map_id` in update/delete so a client cannot reach a
 * signature on a different map via a forged id.
 *
 * Each helper accepts an optional `tx` so a bulk caller (`bulkSignatures.ts`)
 * can commit N sig events under one outer transaction.
 */

export type CreateSignatureInput = {
  mapId: bigint;
  mapSystemId: bigint;
  mapConnectionId?: bigint | null;
  characterId: bigint | null;
  sigId: string;
  groupKey?: SignatureGroupKey | null;
  typeId?: number | null;
  name?: string | null;
  description?: string | null;
  expiresAt: Date;
  tx?: Tx;
};

export type UpdateSignaturePatch = {
  mapConnectionId?: bigint | null;
  sigId?: string;
  groupKey?: SignatureGroupKey | null;
  typeId?: number | null;
  name?: string | null;
  description?: string | null;
  expiresAt?: Date;
};

export type UpdateSignatureInput = {
  mapId: bigint;
  signatureId: bigint;
  characterId: bigint | null;
  patch: UpdateSignaturePatch;
  tx?: Tx;
};

export type DeleteSignatureInput = {
  mapId: bigint;
  signatureId: bigint;
  characterId: bigint | null;
  tx?: Tx;
};

/** Create a scan signature in a map system. Emits `signature.create` with the full body. */
export function createSignature(
  input: CreateSignatureInput,
): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'signature.create',
    tx: input.tx,
    mutate: async (tx) => {
      const [row] = await tx
        .insert(apMapSignature)
        .values({
          mapSystemId: input.mapSystemId,
          mapConnectionId: input.mapConnectionId ?? null,
          sigId: input.sigId,
          groupKey: input.groupKey ?? null,
          typeId: input.typeId ?? null,
          name: input.name ?? null,
          description: input.description ?? null,
          expiresAt: input.expiresAt,
        })
        .returning({
          id: apMapSignature.id,
          mapSystemId: apMapSignature.mapSystemId,
          mapConnectionId: apMapSignature.mapConnectionId,
          sigId: apMapSignature.sigId,
          groupKey: apMapSignature.groupKey,
          typeId: apMapSignature.typeId,
          name: apMapSignature.name,
          description: apMapSignature.description,
          expiresAt: apMapSignature.expiresAt,
          createdAt: apMapSignature.createdAt,
          updatedAt: apMapSignature.updatedAt,
        });
      const wormholeCode = row!.typeId !== null ? await resolveWormholeCode(tx, row!.typeId) : null;
      const leadsToMapSystemId =
        row!.mapConnectionId !== null
          ? await resolveLeadsTo(tx, row!.mapConnectionId, row!.mapSystemId)
          : null;
      return {
        id: row!.id.toString(),
        mapSystemId: row!.mapSystemId.toString(),
        mapConnectionId: row!.mapConnectionId?.toString() ?? null,
        sigId: row!.sigId,
        groupKey: row!.groupKey,
        typeId: row!.typeId,
        wormholeCode,
        name: row!.name,
        description: row!.description,
        expiresAt: row!.expiresAt.toISOString(),
        createdAt: row!.createdAt.toISOString(),
        updatedAt: row!.updatedAt.toISOString(),
        leadsToMapSystemId,
      };
    },
  });
}

/** Resolve `universe_wormhole.name` for a given `type_id`, or null. */
async function resolveWormholeCode(tx: Tx, typeId: number): Promise<string | null> {
  const [row] = await tx
    .select({ name: universeWormhole.name })
    .from(universeWormhole)
    .where(eq(universeWormhole.typeId, typeId));
  return row?.name ?? null;
}

/**
 * Far endpoint (`ap_map_system` id, stringified) of a sig's linked connection,
 * relative to the sig's own system — i.e. what the sig "leads to". Embedded as an
 * audit descriptor so the trail can name the destination of a link/unlink even
 * after the connection collapses. Null when the connection is gone.
 */
async function resolveLeadsTo(
  tx: Tx,
  connectionId: bigint,
  sigMapSystemId: bigint,
): Promise<string | null> {
  const [row] = await tx
    .select({
      source: apMapConnection.sourceMapSystemId,
      target: apMapConnection.targetMapSystemId,
    })
    .from(apMapConnection)
    .where(eq(apMapConnection.id, connectionId));
  if (!row) return null;
  return (row.source === sigMapSystemId ? row.target : row.source).toString();
}

/**
 * Update a signature's fields. Only keys present in `patch` change. Ownership
 * is validated: the signature's map_system must belong to `input.mapId`.
 * Emits `signature.update` with only the changed fields.
 */
export function updateSignature(
  input: UpdateSignatureInput,
): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'signature.update',
    tx: input.tx,
    mutate: async (tx) => {
      const { patch } = input;

      const [existing] = await tx
        .select({
          mapSystemId: apMapSignature.mapSystemId,
          sigId: apMapSignature.sigId,
          mapConnectionId: apMapSignature.mapConnectionId,
        })
        .from(apMapSignature)
        .where(eq(apMapSignature.id, input.signatureId));
      if (!existing) throw new Error('Signature not found.');

      const [sys] = await tx
        .select({ id: apMapSystem.id })
        .from(apMapSystem)
        .where(and(eq(apMapSystem.id, existing.mapSystemId), eq(apMapSystem.mapId, input.mapId)));
      if (!sys) throw new Error('Signature does not belong to this map.');

      const set: Partial<InferInsertModel<typeof apMapSignature>> = { updatedAt: new Date() };
      if ('mapConnectionId' in patch) set.mapConnectionId = patch.mapConnectionId;
      if ('sigId' in patch) set.sigId = patch.sigId;
      if ('groupKey' in patch) set.groupKey = patch.groupKey;
      if ('typeId' in patch) set.typeId = patch.typeId;
      if ('name' in patch) set.name = patch.name;
      if ('description' in patch) set.description = patch.description;
      if ('expiresAt' in patch) set.expiresAt = patch.expiresAt;

      const [row] = await tx
        .update(apMapSignature)
        .set(set)
        .where(eq(apMapSignature.id, input.signatureId))
        .returning({
          id: apMapSignature.id,
          mapSystemId: apMapSignature.mapSystemId,
          mapConnectionId: apMapSignature.mapConnectionId,
          sigId: apMapSignature.sigId,
          groupKey: apMapSignature.groupKey,
          typeId: apMapSignature.typeId,
          name: apMapSignature.name,
          description: apMapSignature.description,
          expiresAt: apMapSignature.expiresAt,
          createdAt: apMapSignature.createdAt,
          updatedAt: apMapSignature.updatedAt,
        });
      if (!row) throw new Error('Signature not found.');

      // Resolve the post-update row's wormhole code once (its `typeId` may be
      // unchanged by this patch); reused by both the audit field and the snapshot.
      const wormholeCode = row.typeId !== null ? await resolveWormholeCode(tx, row.typeId) : null;
      // Far endpoint of the (possibly unchanged) linked connection — rides the
      // snapshot so a client can name the destination of a still-linked sig even
      // when its connection is dormant/hidden (Stage 4 restore offer).
      const snapshotLeadsTo =
        row.mapConnectionId !== null
          ? await resolveLeadsTo(tx, row.mapConnectionId, row.mapSystemId)
          : null;

      const out: MapEventPatch<'signature.update'> = {
        id: row.id.toString(),
        updatedAt: row.updatedAt.toISOString(),
        // Self-describing audit context: owning system, and the resulting code
        // (the edited value when sigId changed, else the unchanged current one).
        mapSystemId: existing.mapSystemId.toString(),
        sigId: patch.sigId ?? existing.sigId,
      };
      if ('mapConnectionId' in patch) {
        out.mapConnectionId = patch.mapConnectionId?.toString() ?? null;
        // Capture what the sig links/unlinks: the new connection's far endpoint when
        // linking, the prior connection's when unlinking (the row's still alive here).
        const refConnectionId = patch.mapConnectionId ?? existing.mapConnectionId;
        out.leadsToMapSystemId =
          refConnectionId !== null
            ? await resolveLeadsTo(tx, refConnectionId, existing.mapSystemId)
            : null;
      }
      if ('groupKey' in patch) out.groupKey = patch.groupKey;
      if ('typeId' in patch) {
        out.typeId = patch.typeId;
        out.wormholeCode = wormholeCode;
      }
      if ('name' in patch) out.name = patch.name;
      if ('description' in patch) out.description = patch.description;
      if ('expiresAt' in patch) out.expiresAt = patch.expiresAt!.toISOString();

      // Full post-update snapshot (Stage 2): lets a client whose baseline is
      // missing/wrong upsert the whole row instead of silently no-op'ing the
      // merge-by-id. Additive — the conditional audit fields above are untouched.
      out.snapshot = {
        id: row.id.toString(),
        mapSystemId: row.mapSystemId.toString(),
        mapConnectionId: row.mapConnectionId?.toString() ?? null,
        sigId: row.sigId,
        groupKey: row.groupKey,
        typeId: row.typeId,
        wormholeCode,
        name: row.name,
        description: row.description,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        leadsToMapSystemId: snapshotLeadsTo,
      };
      return out;
    },
  });
}

/**
 * Hard-delete a signature. Ownership validated through map_system.
 * Emits `signature.delete` → `{ id }`.
 */
export function deleteSignature(
  input: DeleteSignatureInput,
): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'signature.delete',
    tx: input.tx,
    mutate: async (tx) => {
      const [existing] = await tx
        .select({ mapSystemId: apMapSignature.mapSystemId, sigId: apMapSignature.sigId })
        .from(apMapSignature)
        .where(eq(apMapSignature.id, input.signatureId));
      if (!existing) throw new Error('Signature not found.');

      const [sys] = await tx
        .select({ id: apMapSystem.id })
        .from(apMapSystem)
        .where(and(eq(apMapSystem.id, existing.mapSystemId), eq(apMapSystem.mapId, input.mapId)));
      if (!sys) throw new Error('Signature does not belong to this map.');

      const [row] = await tx
        .delete(apMapSignature)
        .where(eq(apMapSignature.id, input.signatureId))
        .returning({ id: apMapSignature.id });
      if (!row) throw new Error('Signature not found.');
      // System + code ride the payload so the audit names the removed sig — the
      // signature row is gone after this delete.
      return {
        id: row.id.toString(),
        mapSystemId: existing.mapSystemId.toString(),
        sigId: existing.sigId,
      };
    },
  });
}
