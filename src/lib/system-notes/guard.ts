import 'server-only';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { db } from '@/db/client';
import { apSystemNote } from '@/db/schema';
import {
  intelScopeForMap,
  resolveIntelViewer,
  scopeAdmits,
  type IntelScopeOwner,
  type IntelTenantGuard,
  type IntelViewer,
} from '@/lib/structures/guard';

/**
 * Authorization + tenancy chokepoint for global system notes, mirroring the
 * structure-intel guard branch for branch (`src/lib/structures/guard.ts`, which
 * also owns the shared pieces this module reuses: `resolveIntelViewer`,
 * `intelScopeForMap`, `scopeAdmits` and the viewer/owner types).
 *
 * A caller outside a row's scope gets 404, not 403: `ap_system_note.id` is a
 * `bigserial`, so a 403 would confirm the row exists and hand back an id
 * oracle. The scope check runs *before* the lock check in the mutation, so a
 * locked row outside the caller's scope 404s rather than 409ing.
 */

export type SystemNoteGuard =
  | { ok: true; characterId: bigint }
  | { ok: false; status: 401 | 404; error: string };

/**
 * `scopeAdmits` as a SQL predicate over `ap_system_note`, for filtering a read
 * in the database rather than after it. An admin matches every row; otherwise a
 * row matches only on its own branch, and a NULL `scope_*` column never equals
 * an id, so the erased-owner `private` row falls out for every non-admin.
 *
 * Must stay branch for branch identical to `scopeAdmits` (and to
 * `structureVisibleTo`, its `ap_structure` twin).
 */
export function noteVisibleTo(viewer: IntelViewer): SQL {
  if (viewer.isAdmin) return sql`true`;
  const branches: SQL[] = [
    and(eq(apSystemNote.scope, 'private'), eq(apSystemNote.scopeCharacterId, viewer.characterId))!,
  ];
  if (viewer.corporationId !== null) {
    branches.push(
      and(
        eq(apSystemNote.scope, 'corp'),
        eq(apSystemNote.scopeCorporationId, viewer.corporationId),
      )!,
    );
  }
  if (viewer.allianceId !== null) {
    branches.push(
      and(
        eq(apSystemNote.scope, 'alliance'),
        eq(apSystemNote.scopeAllianceId, viewer.allianceId),
      )!,
    );
  }
  return or(...branches)!;
}

/**
 * Map-level gate for the note surface on one map, with note-specific refusal
 * copy. System notes belong to the entity that owns the map, so a guest — a
 * character admitted to the map by a role grant from outside that entity — gets
 * no note surface on it at all: no read, no create (their own org's notes on
 * other maps stay theirs).
 *
 * **Returns:** `{ ok: true, viewer, scope }`, where `scope` is the tenancy a
 * new note on this map takes and is null only for an admin on an unowned or
 * soft-deleted map (a create must still refuse that). Otherwise `403` — the
 * caller can see the map, so there is no existence to hide.
 */
export async function requireNoteIntelTenant(
  mapId: bigint,
  characterId: bigint,
): Promise<IntelTenantGuard> {
  const refused = {
    ok: false,
    status: 403,
    error: 'System notes are limited to the corporation or alliance that owns this map.',
  } as const;

  const viewer = await resolveIntelViewer(characterId);
  if (!viewer) return refused;
  const scope = await intelScopeForMap(mapId);
  if (viewer.isAdmin) return { ok: true, viewer, scope };
  if (!scope || !scopeAdmits(scope, viewer)) return refused;
  return { ok: true, viewer, scope };
}

/**
 * Row-scoped write gate for PATCH / DELETE. Loads the target note and admits
 * the caller only if its scope does; `authz_level='admin'` passes everything,
 * as it does in `canViewMap`. A row whose `scope_*` columns are all NULL (the
 * erased `private` owner) is admin-only.
 *
 * **Returns:** `{ ok: true, characterId }`, `401` with no session, or `404`
 * when the row is missing *or* outside the caller's scope — the two are
 * deliberately indistinguishable.
 */
export async function requireSystemNoteMutate(
  session: Session | null | undefined,
  noteId: bigint,
): Promise<SystemNoteGuard> {
  if (!session?.characterId) {
    return { ok: false, status: 401, error: 'You must be signed in.' };
  }
  const characterId = BigInt(session.characterId);
  const notFound = { ok: false, status: 404, error: 'Note not found.' } as const;

  const viewer = await resolveIntelViewer(characterId);
  if (!viewer) return notFound;
  if (viewer.isAdmin) return { ok: true, characterId };

  const [row] = await db
    .select({
      scope: apSystemNote.scope,
      scopeCharacterId: apSystemNote.scopeCharacterId,
      scopeCorporationId: apSystemNote.scopeCorporationId,
      scopeAllianceId: apSystemNote.scopeAllianceId,
    })
    .from(apSystemNote)
    .where(eq(apSystemNote.id, noteId));
  if (!row) return notFound;
  if (!scopeAdmits(row, viewer)) return notFound;
  return { ok: true, characterId };
}

export type { IntelScopeOwner, IntelViewer };
