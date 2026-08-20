import 'server-only';
import { eq, type InferInsertModel } from 'drizzle-orm';
import { db } from '@/db/client';
import { apStructure, apStructureEvent } from '@/db/schema';
import { upsertCorporations } from './corporations';
import type { ApStructure } from '@/types';

/**
 * Structure-intel mutations. Structures are manual intel with no `map_id`, so
 * they do NOT go through `commitMapEvent` / `ap_map_event` and emit no realtime
 * event — they are a plain REST resource.
 *
 * Every mutation writes the `ap_structure` row AND one `ap_structure_event`
 * audit row in the same transaction, stamped with the acting character, so that
 * — since a structure is editable by people other than its creator — griefers
 * remain identifiable. The audit row also carries the row's tenancy denormalized, since
 * a `delete` event outlives the row it describes. Deletes are hard deletes; the
 * audit row carries the full pre-delete snapshot so the intel stays recoverable.
 */

export type CreateStructureInput = {
  systemId: number;
  name: string;
  structureTypeId: number;
  ownerCorporationId?: number | null;
  ownerName?: string | null;
  notes?: string | null;
  characterId: bigint | null;
};

export type UpdateStructurePatch = {
  name?: string;
  structureTypeId?: number;
  ownerCorporationId?: number | null;
  ownerName?: string | null;
  notes?: string | null;
};

export type UpdateStructureInput = {
  structureId: bigint;
  patch: UpdateStructurePatch;
  characterId: bigint | null;
};

export type DeleteStructureInput = {
  structureId: bigint;
  characterId: bigint | null;
};

/**
 * Resolve the owner corp picked in the dialog into the stored FK. The corp name
 * is seeded into `universe_corporation` (so the FK target exists and the name is
 * cached) and only the id is stored on the structure. Returns null when no corp
 * is set. Run before the structure transaction — a stray cache row is harmless
 * if it aborts.
 */
async function resolveOwnerCorporationId(
  corpId: number | null | undefined,
  name: string | null | undefined,
): Promise<bigint | null> {
  const trimmedName = name?.trim() || null;
  if (corpId != null && trimmedName) {
    await upsertCorporations([{ id: corpId, name: trimmedName }]);
    return BigInt(corpId);
  }
  return null;
}

/**
 * The row's tenancy, for denormalizing onto its `ap_structure_event` row. The
 * event table holds the full pre-delete snapshot, so it has to carry the scope
 * itself — on a delete the parent row it would otherwise be read from is gone.
 */
function scopeOf(row: ApStructure) {
  return {
    scope: row.scope,
    scopeCharacterId: row.scopeCharacterId,
    scopeCorporationId: row.scopeCorporationId,
    scopeAllianceId: row.scopeAllianceId,
  };
}

/** Plain JSON snapshot of a structure row for the audit `payload` (no bigints/Dates). */
function snapshot(row: ApStructure) {
  return {
    id: row.id.toString(),
    systemId: row.systemId,
    name: row.name,
    structureTypeId: row.structureTypeId,
    ownerCorporationId: row.ownerCorporationId?.toString() ?? null,
    notes: row.notes,
    createdByCharacterId: row.createdByCharacterId?.toString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Insert a structure + a `create` audit event. Returns the new row. */
export async function createStructure(input: CreateStructureInput): Promise<ApStructure> {
  const ownerCorporationId = await resolveOwnerCorporationId(
    input.ownerCorporationId,
    input.ownerName,
  );
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(apStructure)
      .values({
        systemId: input.systemId,
        name: input.name,
        structureTypeId: input.structureTypeId,
        ownerCorporationId,
        notes: input.notes ?? null,
        createdByCharacterId: input.characterId,
        // Tenancy is meant to come from the map the row is written on, which
        // this helper is not yet told about. Until it is, a new row takes the
        // narrowest scope that exists — visible to its writer alone — so an
        // unwired create can never over-share.
        scope: 'private',
        scopeCharacterId: input.characterId,
      })
      .returning();
    await tx.insert(apStructureEvent).values({
      structureId: row!.id,
      systemId: row!.systemId,
      characterId: input.characterId,
      kind: 'create',
      payload: snapshot(row!),
      ...scopeOf(row!),
    });
    return row!;
  });
}

/**
 * Patch a structure (only present keys change; `updated_at` always bumps) + an
 * `update` audit event carrying the patch. Returns the updated row, or null if
 * the id does not exist (no event written).
 */
export async function updateStructure(input: UpdateStructureInput): Promise<ApStructure | null> {
  const { patch } = input;
  // The dialog sends both owner fields together; either key present means the
  // owner is being set. The corp name only seeds the cache — the structure
  // stores just the FK.
  const ownerKeyPresent = 'ownerCorporationId' in patch || 'ownerName' in patch;
  const ownerCorporationId = ownerKeyPresent
    ? await resolveOwnerCorporationId(patch.ownerCorporationId, patch.ownerName)
    : null;
  return db.transaction(async (tx) => {
    const set: Partial<InferInsertModel<typeof apStructure>> = { updatedAt: new Date() };
    if ('name' in patch) set.name = patch.name;
    if ('structureTypeId' in patch) set.structureTypeId = patch.structureTypeId;
    if (ownerKeyPresent) set.ownerCorporationId = ownerCorporationId;
    if ('notes' in patch) set.notes = patch.notes;

    const [row] = await tx
      .update(apStructure)
      .set(set)
      .where(eq(apStructure.id, input.structureId))
      .returning();
    if (!row) return null;

    await tx.insert(apStructureEvent).values({
      structureId: row.id,
      systemId: row.systemId,
      characterId: input.characterId,
      kind: 'update',
      payload: patch,
      ...scopeOf(row),
    });
    return row;
  });
}

/**
 * Hard-delete a structure + a `delete` audit event holding the full pre-delete
 * snapshot. Returns the deleted row, or null if the id did not exist.
 */
export function deleteStructure(input: DeleteStructureInput): Promise<ApStructure | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(apStructure)
      .where(eq(apStructure.id, input.structureId))
      .returning();
    if (!row) return null;

    await tx.insert(apStructureEvent).values({
      structureId: row.id,
      systemId: row.systemId,
      characterId: input.characterId,
      kind: 'delete',
      payload: snapshot(row),
      ...scopeOf(row),
    });
    return row;
  });
}
