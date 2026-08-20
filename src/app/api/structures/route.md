## route.ts (POST /api/structures)

**Purpose:** Create a manual structure-intel row.
**File:** `src/app/api/structures/route.ts`

---

### POST /api/structures
Body (Zod): `mapId` digit-string, `systemId` int>0, `name` 1–100, `structureTypeId` int>0, `ownerCorporationId` int>0 nullable optional, `ownerName` ≤100 nullable optional, `notes` ≤2000 nullable optional.

Auth runs off the body's `mapId`, not the session alone: `requireMapView(mapId, session)`, then `intelScopeForMap(mapId)` derives the row's `scope` triple from that map's `type` + `owner_*` columns. Calls `createStructure({ …body, characterId, scope })` (which also writes a `create` audit event), then `withTypeName(row)`.

**Responses:** `200 { ok: true, data: StructureIntel }`; `400` invalid JSON / body / FK violation (unknown system or type); `401` not signed in; `404` map missing, soft-deleted, unowned, or not viewable by the caller.

**Not a map event:** the row carries no `map_id` and surfaces on every map showing its system, so this emits no `ap_map_event` / realtime update. The `mapId` in the body exists only to derive the row's scope.
