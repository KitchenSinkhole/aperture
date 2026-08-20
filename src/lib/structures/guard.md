## guard.ts

**Purpose:** Authorization + tenancy chokepoint for structure intel — derives the scope a new row takes, and gates edits/deletes on the scope an existing row carries.
**File:** `src/lib/structures/guard.ts`

---

### intelScopeForMap(mapId: bigint): Promise<IntelScopeOwner | null>
The tenancy an intel row written on this map takes, read from the map's `type` and its `owner_*` columns: `private` → `scope_character_id` = the map's owner character, `corp` → `scope_corporation_id`, `alliance` → `scope_alliance_id`.

**Returns:** the `IntelScopeOwner` to stamp on the insert, or `null` for a missing, soft-deleted, or unowned map (an unowned map cannot express a scope, and inventing one would over-share).

Scope comes from the map and never from the writer's own affiliation, which is what keeps an NPC corp from ever becoming a scope — including on the role-overlay guest path onto someone else's map.

### requireStructureMutate(session, structureId: bigint): Promise<StructureGuard>
Row-scoped write gate for PATCH / DELETE. Loads the target row and admits the caller only if its scope does: `private` matching `scope_character_id`, `corp` matching the caller's `corporation_id`, `alliance` matching their `alliance_id`. `authz_level='admin'` passes everything, as in `canViewMap`; a non-`active` character passes nothing. A row with all three `scope_*` columns NULL (the erased `private` owner) is admin-only.

**Returns:** `StructureGuard = { ok: true; characterId: bigint } | { ok: false; status: 401 | 404; error: string }`. `401` with no session; `404` when the row is missing **or** outside the caller's scope — the two are deliberately indistinguishable, because `ap_structure.id` is a `bigserial` and a 403 would confirm existence and hand back an id oracle.

Vandalism inside a scope stays possible by design: everyone who can see a row can correct it, and `ap_structure_event` is the accountability mechanism.

### Types
- `IntelScopeOwner` — `{ scope: IntelScope; scopeCharacterId: bigint | null; scopeCorporationId: bigint | null; scopeAllianceId: bigint | null }`. Exactly one id is populated, matching `scope`, per `ap_structure`'s CHECK.
