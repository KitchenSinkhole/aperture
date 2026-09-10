## read.ts

**Purpose:** Server-side reads for manual structure intel — per-system structure lists for the sidebar and the Upwell type catalog for the picker.
**File:** `src/lib/structures/read.ts`

---

### type StructureIntel
A structure row shaped for the sidebar: `id`/ids as strings, `typeName` resolved from `universe_type`, `createdByName` from `ap_character`, timestamps as ISO strings. `ownerCorporationId` (`number | null`) is the owner's EVE corp id; `ownerName` is that corp's name from the `universe_corporation` cache (both null when no owner is set). There is no free-text owner — the name has a single source of truth in the cache.

Also carries the row's tenancy: `scope` (`IntelScope` — who may see it) and `scopeEntityId` (`number | null`, the id of the character / corporation / alliance that `scope` names, collapsed from the three `scope_*` columns). `scopeEntityId` is null only for the erased-owner `private` row, which is admin-only. `scope` is unrelated to `ownerCorporationId`, which is the citadel's in-game owner and carries no visibility meaning.

### type UpwellStructureType
`{ typeId, name, groupName }` — one placeable Upwell structure type for the create/edit picker.

---

### structuresForSystems(mapId: bigint, systemIds: number[], viewerCharacterId: bigint): Promise<Record<number, StructureIntel[]>>
Structure intel for the given universe systems as seen on `mapId`, keyed by `system_id`, filtered to the rows the viewer's scope admits (`structureVisibleTo` from `guard.ts`, applied in SQL). One batched query joins `universe_type` (type name), `universe_corporation` (resolved owner name), and `ap_character` (creator name). Empty input → `{}`; a viewer `requireIntelTenant` refuses on this map → `{}`, including any rows of their own that the systems carry; systems with no admitted structures are absent.

**Both the map and the viewer are required, not optional.** `ap_structure` rows carry no `map_id`, so these two filters are the only thing between a caller and the deployment's whole structure log — required parameters make the type checker reject any caller that would reach the table unfiltered.

**No realtime:** this is a load-time snapshot. Structures are system-scoped (not map-scoped) and have no realtime channel, so another user's additions appear only on the next page load.

### upwellStructureTypes(): Promise<UpwellStructureType[]>
Placeable Upwell structure types ordered by name, filtered by the `'Structure'` category **name** (robust across SDE re-ingest) and `published = true`.

### withTypeName(row: ApStructure): Promise<StructureIntel>
Shapes a freshly written `ap_structure` row into a complete `StructureIntel` (resolving `typeName`/`createdByName`, and the owner name from `universe_corporation` when a corp is set) so create/update routes return a spliceable row to the client. Carries the row's `scope`/`scopeEntityId` through, so a row spliced into local state renders identically to one that came from `structuresForSystems`. Applies no scope filter of its own — the caller's write guard already established admission.
