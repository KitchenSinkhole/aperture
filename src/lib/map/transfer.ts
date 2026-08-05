import 'server-only';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  apMap,
  apMapConnection,
  apMapSignature,
  apMapSystem,
  connectionScope,
  eolStage,
  mapScope,
  mapType,
  signatureClassKind,
  signatureGroupKey,
  systemStatus,
  whJumpMass,
  whMass,
} from '@/db/schema';
import { apertureConfig } from '../../../aperture.config';
import { commitMapEvent, type ActionResult } from './mutations/core';
import { createSignature } from './mutations/signatures';
import { buildSystemNode } from './systemNode';
import type { MapEventPayload } from '@/lib/realtime/protocol';

/**
 * Map JSON import/export.
 *
 * `buildMapExport` serialises a map's current state (metadata + behaviour
 * toggles + visible systems + connections + signatures) into a versioned,
 * self-referential JSON document. `importMapData` merges such a document back
 * into an *existing* map (`map_import` is a per-map right): systems upsert by
 * EVE system id, connections + signatures are recreated with their endpoint ids
 * remapped from the export-local ids to the freshly-allocated row ids.
 *
 * Import reuses the bulk-commit pattern from `bulkSignatures.ts`: one outer
 * `db.transaction`, N `commitMapEvent` calls sharing that `tx` so each lands one
 * `ap_map_event` (→ `pg_notify` → realtime fan-out) and the whole batch rolls
 * back atomically if any row fails. The returned `payloads` let the initiating
 * client fold every change locally and dedupe its own realtime echoes.
 *
 * The export carries no row ids that survive import beyond in-file referencing,
 * and no timestamps: `expires_at` is recomputed from the default TTL on import,
 * `eol_at` from `eol_stage` (stamped now when non-`none`), and `created_at`
 * defaults. Re-importing the same file
 * is idempotent for systems (upsert on `(map_id, system_id)`) but APPENDS
 * connections (they have no natural unique key).
 */

// v2: connection `isEol` boolean replaced by the `eolStage` enum (0031).
export const MAP_EXPORT_VERSION = 2;

const systemStatusEnum = z.enum(systemStatus.enumValues);
const connectionScopeEnum = z.enum(connectionScope.enumValues);
const whMassEnum = z.enum(whMass.enumValues);
const whJumpMassEnum = z.enum(whJumpMass.enumValues);
const signatureGroupKeyEnum = z.enum(signatureGroupKey.enumValues);
const signatureClassKindEnum = z.enum(signatureClassKind.enumValues);

const exportSystemSchema = z.object({
  /** Export-local `ap_map_system.id`; only used to wire up connections/signatures in-file. */
  id: z.string(),
  systemId: z.number().int(),
  positionX: z.number(),
  positionY: z.number(),
  alias: z.string().nullable(),
  tag: z.string().nullable(),
  status: systemStatusEnum,
  intelNotes: z.string().nullable(),
  locked: z.boolean(),
});

const exportConnectionSchema = z.object({
  /** Export-local `ap_map_connection.id`; used to wire up wormhole signatures in-file. */
  id: z.string(),
  /** Export-local endpoint ids (reference `systems[].id`). */
  source: z.string(),
  target: z.string(),
  scope: connectionScopeEnum,
  massStatus: whMassEnum,
  jumpMassClass: whJumpMassEnum.nullable(),
  eolStage: z.enum(eolStage.enumValues),
  preserveMass: z.boolean(),
  isRolling: z.boolean(),
  // Optional+default so pre-0032 export files (no `isStatic`) still import.
  isStatic: z.boolean().optional().default(false),
  // Optional+default so pre-0065 export files (no bubbled flags) still import.
  sourceBubbled: z.boolean().optional().default(false),
  targetBubbled: z.boolean().optional().default(false),
});

const exportSignatureSchema = z.object({
  /** Export-local `ap_map_system.id` the sig lives in. */
  mapSystemId: z.string(),
  /** Export-local `ap_map_connection.id` the sig resolves to, or null. */
  mapConnectionId: z.string().nullable(),
  sigId: z.string().min(1).max(7),
  groupKey: signatureGroupKeyEnum.nullable(),
  // Optional + default for forward-compat: exports predating the class-kind
  // column omit it, and import treats a missing kind as unknown.
  classKind: signatureClassKindEnum.nullable().optional().default(null),
  typeId: z.number().int().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
});

export const mapExportSchema = z.object({
  version: z.number().int(),
  map: z.object({
    name: z.string(),
    scope: z.enum(mapScope.enumValues),
    type: z.enum(mapType.enumValues),
    icon: z.string().nullable(),
    deleteExpiredConnections: z.boolean(),
    deleteEolConnections: z.boolean(),
    trackAbyssalJumps: z.boolean(),
    logActivity: z.boolean(),
  }),
  systems: z.array(exportSystemSchema).max(2000),
  connections: z.array(exportConnectionSchema).max(4000),
  signatures: z.array(exportSignatureSchema).max(8000),
});

export type MapExportFile = z.infer<typeof mapExportSchema>;

export type ImportSummary = {
  systems: number;
  connections: number;
  signatures: number;
};

export type ImportResult = {
  summary: ImportSummary;
  payloads: MapEventPayload[];
};

/**
 * Read a map's current visible state into a `MapExportFile`. Throws if the map
 * does not exist or is soft-deleted (callers gate access via `requireMapMutate`
 * with `map_export` first). Exports `intel_notes` (which `loadMapForView`
 * omits) so an import round-trips the full per-system intel.
 */
export async function buildMapExport(mapId: bigint): Promise<MapExportFile> {
  const [map] = await db
    .select({
      name: apMap.name,
      scope: apMap.scope,
      type: apMap.type,
      icon: apMap.icon,
      deleteExpiredConnections: apMap.deleteExpiredConnections,
      deleteEolConnections: apMap.deleteEolConnections,
      trackAbyssalJumps: apMap.trackAbyssalJumps,
      logActivity: apMap.logActivity,
    })
    .from(apMap)
    .where(and(eq(apMap.id, mapId), isNull(apMap.deletedAt)));
  if (!map) throw new Error('Map not found.');

  const systemRows = await db
    .select({
      id: apMapSystem.id,
      systemId: apMapSystem.systemId,
      positionX: apMapSystem.positionX,
      positionY: apMapSystem.positionY,
      alias: apMapSystem.alias,
      tag: apMapSystem.tag,
      status: apMapSystem.status,
      intelNotes: apMapSystem.intelNotes,
      locked: apMapSystem.locked,
    })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.visible, true)))
    .orderBy(asc(apMapSystem.id));

  const connectionRows = await db
    .select({
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
      sourceBubbled: apMapConnection.sourceBubbled,
      targetBubbled: apMapConnection.targetBubbled,
    })
    .from(apMapConnection)
    .where(eq(apMapConnection.mapId, mapId))
    .orderBy(asc(apMapConnection.id));

  const visibleSystemIds = systemRows.map((s) => s.id);
  const signatureRows = visibleSystemIds.length
    ? await db
        .select({
          mapSystemId: apMapSignature.mapSystemId,
          mapConnectionId: apMapSignature.mapConnectionId,
          sigId: apMapSignature.sigId,
          groupKey: apMapSignature.groupKey,
          classKind: apMapSignature.classKind,
          typeId: apMapSignature.typeId,
          name: apMapSignature.name,
          description: apMapSignature.description,
        })
        .from(apMapSignature)
        .where(inArray(apMapSignature.mapSystemId, visibleSystemIds))
        .orderBy(asc(apMapSignature.sigId))
    : [];

  return {
    version: MAP_EXPORT_VERSION,
    map,
    systems: systemRows.map((s) => ({
      id: s.id.toString(),
      systemId: s.systemId,
      positionX: s.positionX,
      positionY: s.positionY,
      alias: s.alias,
      tag: s.tag,
      status: s.status,
      intelNotes: s.intelNotes,
      locked: s.locked,
    })),
    connections: connectionRows.map((c) => ({
      id: c.id.toString(),
      source: c.source.toString(),
      target: c.target.toString(),
      scope: c.scope,
      massStatus: c.massStatus,
      jumpMassClass: c.jumpMassClass,
      eolStage: c.eolStage,
      preserveMass: c.preserveMass,
      isRolling: c.isRolling,
      isStatic: c.isStatic,
      sourceBubbled: c.sourceBubbled,
      targetBubbled: c.targetBubbled,
    })),
    signatures: signatureRows.map((r) => ({
      mapSystemId: r.mapSystemId.toString(),
      mapConnectionId: r.mapConnectionId ? r.mapConnectionId.toString() : null,
      sigId: r.sigId,
      groupKey: r.groupKey,
      classKind: r.classKind,
      typeId: r.typeId,
      name: r.name,
      description: r.description,
    })),
  };
}

/**
 * Merge a validated `MapExportFile` into an existing map. Runs the whole batch
 * under one transaction; on any row failure the transaction rolls back and the
 * result is `{ ok: false }`. The map's own metadata/toggles are NOT touched —
 * import only adds systems/connections/signatures.
 *
 * Remapping: each export-local system id → the upserted `ap_map_system.id`, and
 * each export-local connection id → the inserted `ap_map_connection.id`. Rows
 * whose endpoints don't resolve (a partial/edited file) are skipped rather than
 * aborting the import.
 */
export async function importMapData(args: {
  mapId: bigint;
  characterId: bigint | null;
  data: MapExportFile;
}): Promise<ActionResult<ImportResult>> {
  const { mapId, characterId, data } = args;
  try {
    const result = await db.transaction(async (tx) => {
      const payloads: MapEventPayload[] = [];
      const systemRemap = new Map<string, string>();
      const connRemap = new Map<string, string>();
      let systems = 0;
      let connections = 0;
      let signatures = 0;

      for (const sys of data.systems) {
        const res = await commitMapEvent({
          mapId,
          characterId,
          kind: 'system.added',
          tx,
          mutate: async (innerTx) => {
            const now = new Date();
            const [row] = await innerTx
              .insert(apMapSystem)
              .values({
                mapId,
                systemId: sys.systemId,
                visible: true,
                positionX: sys.positionX,
                positionY: sys.positionY,
                alias: sys.alias,
                tag: sys.tag,
                status: sys.status,
                intelNotes: sys.intelNotes,
                locked: sys.locked,
              })
              .onConflictDoUpdate({
                target: [apMapSystem.mapId, apMapSystem.systemId],
                set: {
                  visible: true,
                  positionX: sys.positionX,
                  positionY: sys.positionY,
                  alias: sys.alias,
                  tag: sys.tag,
                  status: sys.status,
                  intelNotes: sys.intelNotes,
                  locked: sys.locked,
                  lastVisibleAt: now,
                  updatedAt: now,
                },
              })
              .returning({ id: apMapSystem.id });
            systemRemap.set(sys.id, row!.id.toString());
            return buildSystemNode(innerTx, row!.id);
          },
        });
        if (!res.ok) throw new Error(res.error);
        payloads.push(res.data);
        systems += 1;
      }

      for (const conn of data.connections) {
        const source = systemRemap.get(conn.source);
        const target = systemRemap.get(conn.target);
        if (!source || !target || source === target) continue;
        const res = await commitMapEvent({
          mapId,
          characterId,
          kind: 'connection.create',
          tx,
          mutate: async (innerTx) => {
            const [row] = await innerTx
              .insert(apMapConnection)
              .values({
                mapId,
                sourceMapSystemId: BigInt(source),
                targetMapSystemId: BigInt(target),
                scope: conn.scope,
                massStatus: conn.massStatus,
                jumpMassClass: conn.jumpMassClass,
                eolStage: conn.eolStage,
                preserveMass: conn.preserveMass,
                isRolling: conn.isRolling,
                isStatic: conn.isStatic,
                sourceBubbled: conn.sourceBubbled,
                targetBubbled: conn.targetBubbled,
                eolAt: conn.eolStage !== 'none' ? new Date() : null,
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
                sourceBubbled: apMapConnection.sourceBubbled,
                targetBubbled: apMapConnection.targetBubbled,
                eolAt: apMapConnection.eolAt,
                createdAt: apMapConnection.createdAt,
              });
            connRemap.set(conn.id, row!.id.toString());
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
              sourceBubbled: row!.sourceBubbled,
              targetBubbled: row!.targetBubbled,
              eolAt: row!.eolAt ? row!.eolAt.toISOString() : null,
              createdAt: row!.createdAt.toISOString(),
            };
          },
        });
        if (!res.ok) throw new Error(res.error);
        payloads.push(res.data);
        connections += 1;
      }

      const expiresAt = new Date(Date.now() + apertureConfig.SIGNATURE_DEFAULT_TTL_MS);
      for (const sig of data.signatures) {
        const mapSystemId = systemRemap.get(sig.mapSystemId);
        if (!mapSystemId) continue;
        const mapConnectionId =
          sig.mapConnectionId !== null ? connRemap.get(sig.mapConnectionId) : undefined;
        const res = await createSignature({
          mapId,
          mapSystemId: BigInt(mapSystemId),
          mapConnectionId: mapConnectionId ? BigInt(mapConnectionId) : null,
          characterId,
          sigId: sig.sigId,
          groupKey: sig.groupKey,
          classKind: sig.classKind,
          typeId: sig.typeId,
          name: sig.name,
          description: sig.description,
          expiresAt,
          tx,
        });
        if (!res.ok) throw new Error(res.error);
        payloads.push(res.data);
        signatures += 1;
      }

      return { summary: { systems, connections, signatures }, payloads };
    });

    return { ok: true, data: result, eventId: 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Import failed.' };
  }
}
