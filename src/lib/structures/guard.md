## guard.ts

**Purpose:** Authorization + tenancy chokepoint for structure intel — derives the scope a new row takes, gates the whole surface on the map's owning entity, gates edits/deletes on the scope an existing row carries, and owns the admission rule the read side filters by.
**File:** `src/lib/structures/guard.ts`

---

### resolveIntelViewer(characterId: bigint): Promise<IntelViewer | null>
The viewer facts every scope decision keys on, read from `ap_character`.

**Returns:** `IntelViewer`, or `null` when the character is missing or not `active` — a non-actor admits nothing and is admitted by nothing.

### scopeAdmits(row: IntelScopeOwner, viewer: IntelViewer): boolean
Does the row's scope admit the viewer? `private` matches `scope_character_id`, `corp` the viewer's `corporation_id`, `alliance` their `alliance_id`; a NULL `scope_*` column matches nobody. Admin is **not** handled here — callers short-circuit on `viewer.isAdmin` first.

This is the admission rule of record. `structureVisibleTo` is the same rule as SQL, and the two are kept in this one file so they cannot drift apart.

### structureVisibleTo(viewer: IntelViewer): SQL
`scopeAdmits` as a Drizzle predicate over `ap_structure`, so a read filters in the database rather than after it. An admin matches every row. Backed by the `ap_structure_scope_idx` index.

---

### intelScopeForMap(mapId: bigint): Promise<IntelScopeOwner | null>
The tenancy an intel row written on this map takes, read from the map's `type` and its `owner_*` columns: `private` → `scope_character_id` = the map's owner character, `corp` → `scope_corporation_id`, `alliance` → `scope_alliance_id`.

**Returns:** the `IntelScopeOwner` to stamp on the insert, or `null` for a missing, soft-deleted, or unowned map (an unowned map cannot express a scope, and inventing one would over-share).

Scope comes from the map and never from the writer's own affiliation, which is what keeps an NPC corp from ever becoming a scope — including on the role-overlay guest path onto someone else's map.

### requireIntelTenant(mapId: bigint, characterId: bigint): Promise<IntelTenantGuard>
Map-level gate for the whole structure-intel surface: read, create and the UI affordance alike. Admits a caller only if the map's own tenancy (`intelScopeForMap`) admits them, or they are `authz_level='admin'`.

A guest — a character `hasRoleAccess` admits to a map from outside its owning entity — is refused. The map's rows are in a scope that does not admit them, and serving their own organisation's rows instead would overlay one organisation's intel on another's chain, so no intel is available to them on that map in either direction.

**Returns:** `IntelTenantGuard = { ok: true; viewer: IntelViewer; scope: IntelScopeOwner | null } | { ok: false; status: 403; error: string }`. `scope` is the tenancy a new row on this map would take; it is null only for an admin on an unowned or soft-deleted map, so a create path must still refuse that case. The refusal is `403`, not `404` — the caller can see the map, so there is no existence to conceal.

### requireStructureMutate(session, structureId: bigint): Promise<StructureGuard>
Row-scoped write gate for PATCH / DELETE. Loads the target row and admits the caller only if its scope does: `private` matching `scope_character_id`, `corp` matching the caller's `corporation_id`, `alliance` matching their `alliance_id`. `authz_level='admin'` passes everything, as in `canViewMap`; a non-`active` character passes nothing. A row with all three `scope_*` columns NULL (the erased `private` owner) is admin-only.

**Returns:** `StructureGuard = { ok: true; characterId: bigint } | { ok: false; status: 401 | 404; error: string }`. `401` with no session; `404` when the row is missing **or** outside the caller's scope — the two are deliberately indistinguishable, because `ap_structure.id` is a `bigserial` and a 403 would confirm existence and hand back an id oracle.

Vandalism inside a scope stays possible by design: everyone who can see a row can correct it, and `ap_structure_event` is the accountability mechanism.

### Types
- `IntelScopeOwner` — `{ scope: IntelScope; scopeCharacterId: bigint | null; scopeCorporationId: bigint | null; scopeAllianceId: bigint | null }`. Exactly one id is populated, matching `scope`, per `ap_structure`'s CHECK.
- `IntelViewer` — `{ characterId: bigint; corporationId: bigint | null; allianceId: bigint | null; isAdmin: boolean }`. `isAdmin` is `authz_level='admin'`, which admits every row as in `canViewMap`.
- `IntelTenantGuard` — the `requireIntelTenant` result, above.
