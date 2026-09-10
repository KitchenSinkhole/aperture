import 'server-only';
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { db } from '@/db/client';
import { apCharacter, apMap, apStructure } from '@/db/schema';
import type { IntelScope } from '@/types';

/**
 * Authorization + tenancy chokepoint for structure intel. Three concerns, all
 * keyed on the row's `scope` triple rather than on "is there a session":
 *
 *  - `intelScopeForMap` derives the tenancy a new row takes, from the map it is
 *    written on. Never from the writer's own affiliation — that is what keeps an
 *    NPC corp from ever becoming a scope.
 *  - `requireIntelTenant` is the map-level gate: structure intel is a feature of
 *    the map's owning entity, so a guest — a character admitted to the map by a
 *    role grant from outside that entity — gets no intel surface on it at all.
 *  - `requireStructureMutate` admits an edit/delete only from a caller the
 *    existing row's scope admits.
 *  - `scopeAdmits` / `structureVisibleTo` are the same admission rule in its two
 *    forms — a row-at-a-time predicate for the write gate, and a SQL filter for
 *    the read side. They live together so they cannot drift apart.
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

/** The viewer facts every scope decision keys on. */
export type IntelViewer = {
  characterId: bigint;
  corporationId: bigint | null;
  allianceId: bigint | null;
  /** `authz_level='admin'` — admits every row, as in `canViewMap`. */
  isAdmin: boolean;
};

export type StructureGuard =
  | { ok: true; characterId: bigint }
  | { ok: false; status: 401 | 404; error: string };

export type IntelTenantGuard =
  | { ok: true; viewer: IntelViewer; scope: IntelScopeOwner | null }
  | { ok: false; status: 403; error: string };

/**
 * The viewer facts for a character, or `null` when the character is missing or
 * not `active` — a non-actor admits nothing and is admitted by nothing.
 */
export async function resolveIntelViewer(characterId: bigint): Promise<IntelViewer | null> {
  const [actor] = await db
    .select({
      authzLevel: apCharacter.authzLevel,
      status: apCharacter.status,
      corporationId: apCharacter.corporationId,
      allianceId: apCharacter.allianceId,
    })
    .from(apCharacter)
    .where(eq(apCharacter.id, characterId));
  if (!actor || actor.status !== 'active') return null;
  return {
    characterId,
    corporationId: actor.corporationId,
    allianceId: actor.allianceId,
    isAdmin: actor.authzLevel === 'admin',
  };
}

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

/**
 * Does this row's scope admit the viewer? Mirrors `canViewMap`'s owner-match
 * switch. Admin is *not* handled here — callers short-circuit on it first.
 *
 * This is the admission rule of record; `structureVisibleTo` is the same rule
 * expressed as SQL, and the two must stay branch for branch identical.
 */
export function scopeAdmits(row: IntelScopeOwner, viewer: IntelViewer): boolean {
  switch (row.scope) {
    case 'private':
      return row.scopeCharacterId !== null && row.scopeCharacterId === viewer.characterId;
    case 'corp':
      return (
        row.scopeCorporationId !== null &&
        viewer.corporationId !== null &&
        row.scopeCorporationId === viewer.corporationId
      );
    case 'alliance':
      return (
        row.scopeAllianceId !== null &&
        viewer.allianceId !== null &&
        row.scopeAllianceId === viewer.allianceId
      );
  }
}

/**
 * `scopeAdmits` as a SQL predicate over `ap_structure`, for filtering a read in
 * the database rather than after it. An admin matches every row; otherwise a row
 * matches only on its own branch, and a NULL `scope_*` column never equals an
 * id, so the erased-owner `private` row falls out for every non-admin.
 */
export function structureVisibleTo(viewer: IntelViewer): SQL {
  if (viewer.isAdmin) return sql`true`;
  const branches: SQL[] = [
    and(eq(apStructure.scope, 'private'), eq(apStructure.scopeCharacterId, viewer.characterId))!,
  ];
  if (viewer.corporationId !== null) {
    branches.push(
      and(eq(apStructure.scope, 'corp'), eq(apStructure.scopeCorporationId, viewer.corporationId))!,
    );
  }
  if (viewer.allianceId !== null) {
    branches.push(
      and(eq(apStructure.scope, 'alliance'), eq(apStructure.scopeAllianceId, viewer.allianceId))!,
    );
  }
  return or(...branches)!;
}

/**
 * Map-level gate for the whole structure-intel surface. Structure intel belongs
 * to the entity that owns the map, so it is available only to a caller that
 * entity admits — plus an admin, as everywhere else.
 *
 * A guest (a character `hasRoleAccess` lets onto a map from outside its owning
 * entity) is refused: the map's own rows are not in a scope that admits them,
 * and showing them their own corp's rows instead would overlay one organisation's
 * intel on another's chain. So they get no intel on this map at all — no read,
 * no create.
 *
 * **Returns:** `{ ok: true, viewer, scope }`, where `scope` is the tenancy a new
 * row on this map would take and is null only for an admin on an unowned or
 * soft-deleted map (a create must still refuse that). Otherwise `403` — the
 * caller can see the map, so there is no existence to hide.
 */
export async function requireIntelTenant(
  mapId: bigint,
  characterId: bigint,
): Promise<IntelTenantGuard> {
  const refused = {
    ok: false,
    status: 403,
    error: 'Structure intel is limited to the corporation or alliance that owns this map.',
  } as const;

  const viewer = await resolveIntelViewer(characterId);
  if (!viewer) return refused;
  const scope = await intelScopeForMap(mapId);
  if (viewer.isAdmin) return { ok: true, viewer, scope };
  if (!scope || !scopeAdmits(scope, viewer)) return refused;
  return { ok: true, viewer, scope };
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

  const viewer = await resolveIntelViewer(characterId);
  if (!viewer) return notFound;
  if (viewer.isAdmin) return { ok: true, characterId };

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
  if (!scopeAdmits(row, viewer)) return notFound;
  return { ok: true, characterId };
}
