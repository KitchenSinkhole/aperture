## guard.ts

**Purpose:** Authorization + tenancy chokepoint for global system notes, mirroring the structure-intel guard branch for branch (and reusing its shared pieces).
**File:** `src/lib/system-notes/guard.ts`

A caller outside a row's scope gets 404, not 403: `ap_system_note.id` is a `bigserial`, so a 403 would confirm the row exists and hand back an id oracle. The scope check runs before the mutation's lock check, so a locked row outside the caller's scope 404s rather than 409ing.

Reuses `resolveIntelViewer`, `intelScopeForMap`, `scopeAdmits`, and the `IntelViewer` / `IntelScopeOwner` / `IntelTenantGuard` types from `src/lib/structures/guard.ts` (re-exporting the two types for the note modules).

---

### noteVisibleTo(viewer: IntelViewer): SQL
`scopeAdmits` as a SQL predicate over `ap_system_note`, for filtering a read in the database rather than after it. An admin matches every row; otherwise a row matches only on its own branch, and a NULL `scope_*` column never equals an id, so the erased-owner `private` row falls out for every non-admin. Must stay branch for branch identical to `scopeAdmits` (and to `structureVisibleTo`, its `ap_structure` twin).

### requireNoteIntelTenant(mapId: bigint, characterId: bigint): Promise<IntelTenantGuard>
Map-level gate for the note surface on one map, with note-specific refusal copy. Notes belong to the entity that owns the map, so a guest — admitted to the map by a role grant from outside that entity — gets no note surface on it at all: no read, no create. Returns `{ ok: true, viewer, scope }` where `scope` is the tenancy a new note on this map takes (null only for an admin on an unowned/soft-deleted map — a create must still refuse that); otherwise `403` (the caller can see the map, so there is no existence to hide).

### requireSystemNoteMutate(session, noteId: bigint): Promise<SystemNoteGuard>
Row-scoped write gate for PATCH / DELETE. Loads the target note and admits the caller only if its scope does; `authz_level='admin'` passes everything. Returns `{ ok: true, characterId }`, `401` with no session, or `404` when the row is missing *or* outside the caller's scope — deliberately indistinguishable.
