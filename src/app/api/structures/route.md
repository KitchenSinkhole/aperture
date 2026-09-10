## route.ts (POST /api/structures)

**Purpose:** Create a manual structure-intel row.
**File:** `src/app/api/structures/route.ts`

---

### POST /api/structures
Body (Zod): `mapId` digit-string, `systemId` int>0, `name` 1–100, `structureTypeId` int>0, `ownerCorporationId` int>0 nullable optional, `ownerName` ≤100 nullable optional, `notes` ≤2000 nullable optional.

Auth runs off the body's `mapId`, not the session alone: `requireMapView(mapId, session)`, then `requireIntelTenant(mapId, characterId)`, whose `scope` is the row's tenancy derived from that map's `type` + `owner_*` columns. Calls `createStructure({ …body, characterId, scope })` (which also writes a `create` audit event), then `withTypeName(row)`.

Viewing the map is not enough: the caller must belong to the entity that owns it. A guest admitted by a role grant is refused, rather than allowed to write a row their own read filter would then hide from them.

**Responses:** `200 { ok: true, data: StructureIntel }`; `400` invalid JSON / body / FK violation (unknown system or type); `401` not signed in; `403` caller can view the map but is outside its owning entity; `404` map missing, soft-deleted, unowned, or not viewable by the caller.

**Not a map event:** the row carries no `map_id` and surfaces on every map showing its system, so this emits no `ap_map_event` / realtime update. The `mapId` in the body exists only to derive the row's scope.
