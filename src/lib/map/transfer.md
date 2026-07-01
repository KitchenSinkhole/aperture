## transfer.ts

**Purpose:** Map JSON import/export — serialise a map's state to a versioned document and merge such a document back into an existing map.
**File:** `src/lib/map/transfer.ts`

---

### MAP_EXPORT_VERSION
`number` constant (`2`) stamped into every export and carried (unchecked beyond being a number) on import. v2 replaced the per-connection `isEol` boolean with the `eolStage` enum (`none`/`eol`/`critical`); `eol_at` is stamped to now on import when `eolStage !== 'none'`.

---

### mapExportSchema
Zod schema validating an import file. Shape: `{ version, map: { name, scope, type, icon, deleteExpiredConnections, deleteEolConnections, trackAbyssalJumps, logActivity }, systems[], connections[], signatures[] }`. Each connection carries `isStatic` (optional + defaults `false`, so pre-0032 export files still import). Each signature carries `classKind` (`signature`/`anomaly`, optional + defaults `null`, so export files predating the class-kind column still import). Arrays are bounded defensively. System/connection `id` fields are **export-local** strings used only for in-file referencing (connections reference `systems[].id`; wormhole signatures reference `connections[].id`); they are not trusted as DB ids on import.

**Exported type:** `MapExportFile = z.infer<typeof mapExportSchema>`.

---

### buildMapExport(mapId: bigint): Promise<MapExportFile>
Reads the map's metadata + four behaviour toggles, its visible `ap_map_system` rows (including `intel_notes`, which `loadMapForView` omits), all `ap_map_connection` rows, and the `ap_map_signature` rows in visible systems, into a `MapExportFile`. Omits timestamps and DB ids (beyond export-local references).

**Throws:** `Map not found.` if the map is missing or soft-deleted (callers gate `map_export` first).
**Returns:** the export document.

---

### importMapData(args): Promise<ActionResult<ImportResult>>
Merges a validated `MapExportFile` into an existing map under one `db.transaction`, mirroring `bulkSignatures.ts`: each row is one `commitMapEvent` call sharing the outer `tx` (one `ap_map_event` + realtime echo per row). Systems upsert on `(map_id, system_id)` (setting position/alias/tag/status/intelNotes/locked + `visible=true`); connections insert with endpoints remapped from export-local system ids; signatures reuse `createSignature(tx)` with `expiresAt = now + SIGNATURE_DEFAULT_TTL_MS` and `mapConnectionId` remapped. The map's own metadata/toggles are not modified.

**Parameters:**
- `mapId` — target map (the open map; `map_import` checked by the caller).
- `characterId` — audit FK for every emitted event.
- `data` — the validated `MapExportFile`.

**Returns:** `{ ok: true, data: { summary: { systems, connections, signatures }, payloads: MapEventPayload[] }, eventId: 0 }` — the bulk shape (`eventId` 0; consumers read `data.payloads[].eventId`). Any row failure rolls back the whole batch and yields `{ ok: false, error }`.

**Notes:** Rows whose remapped endpoints don't resolve (a partial/edited file) are skipped, not fatal. Re-importing is idempotent for systems (upsert) but appends connections (no natural unique key).

**Exported types:** `ImportSummary`, `ImportResult`.
