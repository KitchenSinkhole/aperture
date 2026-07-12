## import/route.ts

**Purpose:** POST endpoint that merges an uploaded `MapExportFile` into the open map.
**File:** `src/app/api/map/[mapId]/import/route.ts`

---

### POST /api/map/[mapId]/import
Gates with `requireMapCapability(rawMapId, session, 'map_import')` (manager implicitly, or a delegated corp title), validates the JSON body against `mapExportSchema`, then calls `importMapData({ mapId, characterId, data })`. Returns the bulk shape `{ ok, data: { summary, payloads }, eventId: 0 }` (consumers read `data.payloads[].eventId`). The whole import is one transaction — any row failure rolls back and yields `400 { ok: false, error }`.

**Responses:** `200 { ok: true, data: { summary, payloads } }`; `400` for invalid JSON / schema-invalid file / import failure; `401/403/404` from the guard.

### Depends On
- `requireMapCapability` (`src/app/api/map/utils.ts`), `importMapData` + `mapExportSchema` (`src/lib/map/transfer.ts`), `getSession`.
