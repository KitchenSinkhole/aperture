## GET /api/wormhole-types

**Purpose:** Serve the full, system-independent wormhole catalog for the signature inspector's WH-type dropdown.
**File:** `src/app/api/wormhole-types/route.ts`

### Request
`GET /api/wormhole-types` — no params.

### Access
Any authenticated user (gated on `session.characterId`). Static SDE reference data, same sensitivity as `/api/structure-types`; **not** map-scoped (the catalog is identical for every map and system).

### Response
`{ ok: true, data: WormholeCatalogEntry[] }` — every `universe_wormhole` row (`typeId`, `name`, `sourceClasses`, `targetClass`, `jumpMassClass`) ordered by code, via `wormholeCatalog()`. `401 { ok: false, error }` when signed out.

### Notes
The client (`fetchWormholeCatalog`) caches the response for the whole session behind a single in-flight promise, so opening many WH-sig dropdowns triggers **one** fetch (previously one per dropdown per system). Per-system `isStatic`/`matchesClass` grouping is computed on the client from `MapSystemNode.security` + `MapSystemNode.staticTypeIds` (`annotateWormholeTypes`).
