import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  apCharacter,
  apStructure,
  universeCategory,
  universeCorporation,
  universeGroup,
  universeType,
} from '@/db/schema';
import type { ApStructure, IntelScope } from '@/types';
import { requireIntelTenant, structureVisibleTo } from './guard';

/** A structure-intel row shaped for the sidebar (ids as strings, type name resolved). */
export type StructureIntel = {
  id: string;
  systemId: number;
  name: string;
  structureTypeId: number;
  typeName: string;
  /** EVE corporation id of the owner, or null when unknown. */
  ownerCorporationId: number | null;
  /** Owner corp name from the `universe_corporation` cache; null when no owner is set. */
  ownerName: string | null;
  notes: string | null;
  /** `ap_character.name` of the creator — light at-a-glance accountability. Null if erased. */
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Who may see this row. Distinct from `ownerCorporationId`, the citadel's in-game owner. */
  scope: IntelScope;
  /**
   * The id of the entity `scope` names — character, corporation or alliance.
   * Null only for the erased-owner `private` row, which is admin-only.
   */
  scopeEntityId: number | null;
};

/** The one populated `scope_*` id for a row's branch, as a number. */
function scopeEntityIdOf(row: {
  scope: IntelScope;
  scopeCharacterId: bigint | null;
  scopeCorporationId: bigint | null;
  scopeAllianceId: bigint | null;
}): number | null {
  const id =
    row.scope === 'private'
      ? row.scopeCharacterId
      : row.scope === 'corp'
        ? row.scopeCorporationId
        : row.scopeAllianceId;
  return id === null ? null : Number(id);
}

/** An Upwell structure type for the create/edit picker. */
export type UpwellStructureType = { typeId: number; name: string; groupName: string };

/**
 * Structure intel for the given universe systems as seen on `mapId`, keyed by
 * `system_id`, filtered to the rows `viewerCharacterId`'s scope admits. One
 * batched query joins `universe_type` for the type name and `ap_character` for
 * the creator name. Systems with no admitted structures are absent from the
 * record.
 *
 * Empty for a viewer `requireIntelTenant` refuses — a guest on someone else's
 * map sees no intel there, including their own organisation's rows.
 *
 * Map and viewer are both required rather than optional so no caller can reach
 * the table unfiltered: `ap_structure` rows carry no `map_id`, so these filters
 * are the only thing standing between a 256-system `system-data` sweep and the
 * deployment's whole structure log.
 *
 * NOTE: structure intel has no realtime channel (it is system-scoped, not
 * map-scoped — see `ap_structure`). This snapshot is load-time only: a structure
 * another user adds appears here on the next page load, not live.
 */
export async function structuresForSystems(
  mapId: bigint,
  systemIds: number[],
  viewerCharacterId: bigint,
): Promise<Record<number, StructureIntel[]>> {
  if (systemIds.length === 0) return {};
  const tenant = await requireIntelTenant(mapId, viewerCharacterId);
  if (!tenant.ok) return {};
  const viewer = tenant.viewer;

  const rows = await db
    .select({
      id: apStructure.id,
      systemId: apStructure.systemId,
      name: apStructure.name,
      structureTypeId: apStructure.structureTypeId,
      typeName: universeType.name,
      ownerCorporationId: apStructure.ownerCorporationId,
      ownerName: universeCorporation.name,
      notes: apStructure.notes,
      createdByName: apCharacter.name,
      createdAt: apStructure.createdAt,
      updatedAt: apStructure.updatedAt,
      scope: apStructure.scope,
      scopeCharacterId: apStructure.scopeCharacterId,
      scopeCorporationId: apStructure.scopeCorporationId,
      scopeAllianceId: apStructure.scopeAllianceId,
    })
    .from(apStructure)
    .innerJoin(universeType, eq(apStructure.structureTypeId, universeType.id))
    .leftJoin(universeCorporation, eq(apStructure.ownerCorporationId, universeCorporation.id))
    .leftJoin(apCharacter, eq(apStructure.createdByCharacterId, apCharacter.id))
    .where(and(inArray(apStructure.systemId, systemIds), structureVisibleTo(viewer)))
    .orderBy(asc(apStructure.systemId), asc(apStructure.name));

  const out: Record<number, StructureIntel[]> = {};
  for (const r of rows) {
    (out[r.systemId] ??= []).push({
      id: r.id.toString(),
      systemId: r.systemId,
      name: r.name,
      structureTypeId: r.structureTypeId,
      typeName: r.typeName,
      ownerCorporationId: r.ownerCorporationId === null ? null : Number(r.ownerCorporationId),
      ownerName: r.ownerName,
      notes: r.notes,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      scope: r.scope,
      scopeEntityId: scopeEntityIdOf(r),
    });
  }
  return out;
}

/**
 * The placeable Upwell structure types (Astrahus, Fortizar, Keepstar, Raitaru,
 * Azbel, Sotiyo, Athanor, Tatara, Ansiblex, …), ordered by name, for the
 * create/edit picker. Filters by the `'Structure'` category *name* rather than a
 * hard-coded id so it survives an SDE re-ingest.
 */
export async function upwellStructureTypes(): Promise<UpwellStructureType[]> {
  const rows = await db
    .select({
      typeId: universeType.id,
      name: universeType.name,
      groupName: universeGroup.name,
    })
    .from(universeType)
    .innerJoin(universeGroup, eq(universeType.groupId, universeGroup.id))
    .innerJoin(universeCategory, eq(universeGroup.categoryId, universeCategory.id))
    .where(and(eq(universeCategory.name, 'Structure'), eq(universeType.published, true)))
    .orderBy(asc(universeType.name));
  return rows;
}

/**
 * Shape a freshly written `ap_structure` row into a `StructureIntel` for the
 * client, resolving `typeName` and `createdByName`. Used by the create/update
 * routes so the client always receives a complete row to splice into local state.
 */
export async function withTypeName(row: ApStructure): Promise<StructureIntel> {
  const [typeRow] = await db
    .select({ name: universeType.name })
    .from(universeType)
    .where(eq(universeType.id, row.structureTypeId));
  let createdByName: string | null = null;
  if (row.createdByCharacterId !== null) {
    const [charRow] = await db
      .select({ name: apCharacter.name })
      .from(apCharacter)
      .where(eq(apCharacter.id, row.createdByCharacterId));
    createdByName = charRow?.name ?? null;
  }
  // The owner name lives only in the cache; resolve it from the FK (null owner → null).
  let ownerName: string | null = null;
  if (row.ownerCorporationId !== null) {
    const [corpRow] = await db
      .select({ name: universeCorporation.name })
      .from(universeCorporation)
      .where(eq(universeCorporation.id, row.ownerCorporationId));
    ownerName = corpRow?.name ?? null;
  }
  return {
    id: row.id.toString(),
    systemId: row.systemId,
    name: row.name,
    structureTypeId: row.structureTypeId,
    typeName: typeRow?.name ?? '',
    ownerCorporationId: row.ownerCorporationId === null ? null : Number(row.ownerCorporationId),
    ownerName,
    notes: row.notes,
    createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    scope: row.scope,
    scopeEntityId: scopeEntityIdOf(row),
  };
}
