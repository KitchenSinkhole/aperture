## mutations.ts

**Purpose:** Create/update/delete manual structure intel, each writing the `ap_structure` row plus an `ap_structure_event` audit row in one transaction.
**File:** `src/lib/structures/mutations.ts`

---

Structures have no `map_id`, so these do **not** use `commitMapEvent`/`ap_map_event` and emit no realtime event — they are a plain REST resource. A structure is editable by people other than its creator, so every mutation is stamped with the acting character in `ap_structure_event` for griefer accountability. All three helpers take `characterId: bigint | null`.

Each audit event also carries the row's tenancy (`scope` + the `scope_*` triple) denormalized onto the event row, copied from the structure row inside the same transaction. The event table holds the full pre-delete snapshot, so it must carry the scope itself: on a `delete` the parent row it would otherwise be read from is gone.

### createStructure(input: CreateStructureInput): Promise<ApStructure>
Inserts the structure + a `create` audit event (payload = the new row snapshot). Returns the new row. Throws on FK violation (bad `systemId`/`structureTypeId`) — the route maps that to 400.

The new row is scoped `private` to `characterId`. The helper is not given the map the row was written on, so it writes the narrowest scope that exists rather than a shared one — an unwired create cannot over-share.

### updateStructure(input: UpdateStructureInput): Promise<ApStructure | null>
Patches only the keys present in `patch`; always bumps `updated_at`. Writes an `update` audit event (payload = the patch). Returns the updated row, or `null` if the id does not exist (no event written → route returns 404).

### deleteStructure(input: DeleteStructureInput): Promise<ApStructure | null>
Hard-deletes the row + a `delete` audit event holding the full pre-delete snapshot (so the intel is recoverable). Returns the deleted row, or `null` if missing (→ 404).

### Input types
- `CreateStructureInput` — `{ systemId, name, structureTypeId, ownerCorporationId?, ownerName?, notes?, characterId }`
- `UpdateStructurePatch` — `{ name?, structureTypeId?, ownerCorporationId?, ownerName?, notes? }`
- `UpdateStructureInput` — `{ structureId, patch, characterId }`
- `DeleteStructureInput` — `{ structureId, characterId }`

`ownerCorporationId` arrives as `number | null` (the EVE corp id resolved from ESI search) and `ownerName` as that corp's name. The structure stores only the FK: a resolved corp upserts `{ id, name }` into `universe_corporation` (guaranteeing the FK target + caching the name) and stores `owner_corporation_id`; with no corp the id is null. There is no free-text owner column — the name lives solely in `universe_corporation`. The dialog always sends both keys, so an update treats either key's presence as "owner is being set".
