## client.ts

**Purpose:** Browser-side fetch wrappers for the structure-intel REST routes.
**File:** `src/lib/structures/client.ts`

---

Built on `requestJson` (`@/lib/http/fetchJson`), so toasts + error folding are shared. Returns `FetchResult<T>` (no `eventId` — structures emit no realtime event); the caller awaits the returned `StructureIntel` and updates local state directly.

### createStructureOnServer(body: CreateStructureBody): Promise<FetchResult<StructureIntel>>
`POST /api/structures`.

### updateStructureOnServer({ structureId, patch: UpdateStructureBody }): Promise<FetchResult<StructureIntel>>
`PATCH /api/structures/:id`.

### deleteStructureOnServer({ structureId }): Promise<FetchResult<{ id: string }>>
`DELETE /api/structures/:id`.

### fetchStructureTypes(): Promise<FetchResult<UpwellStructureType[]>>
`GET /api/structure-types`. Module-level per-session cache (static reference data).

### searchCorporationsOnServer(query: string): Promise<FetchResult<CorpSearchResult[]>>
`GET /api/structures/corp-search?q=…`. Corporation name autocomplete for the owner picker. Caller debounces; under 3 chars the server returns `[]`.

### Body types
- `CreateStructureBody` — `{ mapId, systemId, name, structureTypeId, ownerCorporationId?, ownerName?, notes? }`. `mapId` is the map the row is written on; the server derives the row's scope from it and rejects a map the caller cannot view.
- `UpdateStructureBody` — `{ name?, structureTypeId?, ownerCorporationId?, ownerName?, notes? }`
