## route.ts — GET /api/map/[mapId]

**Purpose:** Returns the full authoritative map view snapshot (`MapViewData`) — the same shape the server component feeds `MapCanvas` at mount. Backs the client's on-error resync failsafe (`fetchMapSnapshot` in `client.ts`), which refetches and resets local state when a mutation fails, so client/server drift self-heals against DB truth.
**File:** `src/app/api/map/[mapId]/route.ts`

### GET
**Response:** `{ ok: true, data: MapViewData }` — `data` is the output of `loadMapForView(mapId, viewerCharacterId, viewerUserId)` (map header, visible systems, connections, signatures, presence as this viewer may see it under Blackout, and the viewer's Blackout standing).

**Responses:** 200 ok, 400 invalid map id, 401 unauthenticated, 403 no view right, 404 map not found / soft-deleted / not visible to viewer.

### Depends On
- `requireMapView` (`src/app/api/map/utils.ts`) — session + parse + view-right guard.
- `loadMapForView` (`src/lib/map/loadMap.ts`) — authoritative server loader for `MapViewData`.
