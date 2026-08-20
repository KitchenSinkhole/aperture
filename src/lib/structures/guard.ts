import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { db } from '@/db/client';
import { apCharacter, apMap, apStructure } from '@/db/schema';
import type { IntelScope } from '@/types';

/**
 * Authorization + tenancy chokepoint for structure intel. Two concerns, both
 * keyed on the row's `scope` triple rather than on "is there a session":
 *
 *  - `intelScopeForMap` derives the tenancy a new row takes, from the map it is
 *    written on. Never from the writer's own affiliation — that is what keeps an
 *    NPC corp from ever becoming a scope.
 *  - `requireStructureMutate` admits an edit/delete only from a caller the
 *    existing row's scope admits.
 *
 * A caller outside a row's scope gets 404, not 403: `ap_structure.id` is a
 * `bigserial`, so a 403 would confirm the row exists and hand back an id oracle.
 * Accountability *inside* a scope stays with the `ap_structure_event` audit log —
 * everyone who can see a row can correct it, because the corp that first logged
 * a structure is usually not the one that later finds it unanchored.
 */

/** A row's tenancy: `scope` plus the one `scope_*` id its branch populates. */
export type IntelScopeOwner = {
  scope: IntelScope;
  scopeCharacterId: bigint | null;
  scopeCorporationId: bigint | null;
  scopeAllianceId: bigint | null;
};

export type StructureGuard =
  | { ok: true; characterId: bigint }
  | { ok: false; status: 401 | 404; error: string };

/**
 * The tenancy an intel row written on this map takes. Returns `null` for a
 * missing, soft-deleted, or unowned map — an unowned map cannot express a scope,
 * and inventing one would over-share.
 */
export async function intelScopeForMap(mapId: bigint): Promise<IntelScopeOwner | null> {
  const [map] = await db
    .select({
      type: apMap.type,
      ownerCharacterId: apMap.ownerCharacterId,
      ownerCorporationId: apMap.ownerCorporationId,
      ownerAllianceId: apMap.ownerAllianceId,
    })
    .from(apMap)
    .where(and(eq(apMap.id, mapId), isNull(apMap.deletedAt)));
  if (!map) return null;

  const empty = { scopeCharacterId: null, scopeCorporationId: null, scopeAllianceId: null };
  switch (map.type) {
    case 'private':
      if (map.ownerCharacterId === null) return null;
      return { ...empty, scope: 'private', scopeCharacterId: map.ownerCharacterId };
    case 'corp':
      if (map.ownerCorporationId === null) return null;
      return { ...empty, scope: 'corp', scopeCorporationId: map.ownerCorporationId };
    case 'alliance':
      if (map.ownerAllianceId === null) return null;
      return { ...empty, scope: 'alliance', scopeAllianceId: map.ownerAllianceId };
  }
}

/** Does this row's scope admit the actor? Mirrors `canViewMap`'s owner-match switch. */
function scopeAdmits(
  row: IntelScopeOwner,
  characterId: bigint,
  corporationId: bigint | null,
  allianceId: bigint | null,
): boolean {
  switch (row.scope) {
    case 'private':
      return row.scopeCharacterId !== null && row.scopeCharacterId === characterId;
    case 'corp':
      return (
        row.scopeCorporationId !== null &&
        corporationId !== null &&
        row.scopeCorporationId === corporationId
      );
    case 'alliance':
      return (
        row.scopeAllianceId !== null && allianceId !== null && row.scopeAllianceId === allianceId
      );
  }
}

/**
 * Row-scoped write gate for PATCH / DELETE. Loads the target row and admits the
 * caller only if its scope does; `authz_level='admin'` passes everything, as it
 * does in `canViewMap`. A row whose `scope_*` columns are all NULL (the erased
 * `private` owner) is admin-only.
 *
 * **Returns:** `{ ok: true, characterId }`, `401` with no session, or `404` when
 * the row is missing *or* outside the caller's scope — the two are deliberately
 * indistinguishable.
 */
export async function requireStructureMutate(
  session: Session | null | undefined,
  structureId: bigint,
): Promise<StructureGuard> {
  if (!session?.characterId) {
    return { ok: false, status: 401, error: 'You must be signed in.' };
  }
  const characterId = BigInt(session.characterId);
  const notFound = { ok: false, status: 404, error: 'Structure not found.' } as const;

  const [actor] = await db
    .select({
      authzLevel: apCharacter.authzLevel,
      status: apCharacter.status,
      corporationId: apCharacter.corporationId,
      allianceId: apCharacter.allianceId,
    })
    .from(apCharacter)
    .where(eq(apCharacter.id, characterId));
  if (!actor || actor.status !== 'active') return notFound;
  if (actor.authzLevel === 'admin') return { ok: true, characterId };

  const [row] = await db
    .select({
      scope: apStructure.scope,
      scopeCharacterId: apStructure.scopeCharacterId,
      scopeCorporationId: apStructure.scopeCorporationId,
      scopeAllianceId: apStructure.scopeAllianceId,
    })
    .from(apStructure)
    .where(eq(apStructure.id, structureId));
  if (!row) return notFound;
  if (!scopeAdmits(row, characterId, actor.corporationId, actor.allianceId)) return notFound;
  return { ok: true, characterId };
}
