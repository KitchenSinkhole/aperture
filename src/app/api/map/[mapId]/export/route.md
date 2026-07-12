## export/route.ts

**Purpose:** GET endpoint that serialises a map's current state to a downloadable `MapExportFile` JSON document.
**File:** `src/app/api/map/[mapId]/export/route.ts`

---

### GET /api/map/[mapId]/export
Gates with `requireMapCapability(rawMapId, session, 'map_export')` (manager implicitly, or a delegated corp title), then returns `{ ok: true, data: MapExportFile }` from `buildMapExport(mapId)`. This is a read, so the body carries no `eventId`. The client (`exportMapOnServer` → `MapSettingsDialog`) names and downloads the file.

**Responses:** `200 { ok: true, data }`; `400/401/403/404` from the guard; `500 { ok: false, error }` if `buildMapExport` throws (e.g. map vanished mid-request).

### Depends On
- `requireMapCapability` (`src/app/api/map/utils.ts`), `buildMapExport` (`src/lib/map/transfer.ts`), `getSession`.
