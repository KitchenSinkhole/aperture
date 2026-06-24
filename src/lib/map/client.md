## client.ts

**Purpose:** Browser-side fetch wrappers for the JSON API routes. The network layer for `MapCanvas`'s optimistic+reconcile flow.
**File:** `src/lib/map/client.ts`

Each helper returns `ActionResult<MapEventPayload>` — same shape as the route — so the caller can feed the success `data` straight into `applyEvent`. The helpers do not touch view state: optimistic apply / rollback / dedupe is orchestrated in `MapCanvas`. On a non-2xx response or network throw, helpers fire a `toast.error` and return `{ ok: false, error }`.

---

### Wire-shape input types

| Type | Used by | Notes |
|---|---|---|
| `UpdateSystemBody` | `updateSystemOnServer` | Mirrors `PATCH /api/map/[mapId]/systems/[systemId]` Zod schema. `rallyAt` is an ISO string. |
| `CreateConnectionBody` | `createConnectionOnServer` | `sourceMapSystemId` / `targetMapSystemId` are `ap_map_system.id` strings (digits). |
| `UpdateConnectionBody` | `updateConnectionOnServer` | Includes `isStatic` (designate as the source system's static). |
| `CreateSignatureBody` | `createSignatureOnServer` | `mapSystemId` digits; `expiresAt` ISO string. |
| `UpdateSignatureBody` | `updateSignatureOnServer` | `mapConnectionId` digits or null; `expiresAt` optional ISO. |
| `CreateNoteBody` | `addNoteOnServer` | Mirrors `POST /api/map/[mapId]/notes`. `severity` defaults to `neutral` server-side; `positionX`/`positionY` required. |
| `UpdateNoteBody` | `updateNoteOnServer` | All fields optional; mirrors `PATCH /api/map/[mapId]/notes/[noteId]`. |

---

### addSystemOnServer({ mapId, systemId, positionX?, positionY? }): Promise<ActionResult<AddSystemResult>>
POSTs `/api/map/{mapId}/systems`. Returns `{ payloads }` — the `system.added` event plus any auto-created `stargate` gate links to systems already on the map — so the caller folds `data.payloads` via `onBulkPaste` (wrapper-level `eventId` is always `0`). Drives the manual "add system" dialog (passing a placement `positionX`/`positionY`).

### searchSystemsOnServer({ mapId, query }): Promise<FetchResult<SystemSearchResult[]>>
GET `/api/map/{mapId}/system-search?q=`. Read-only (view rights) so no `eventId`. Feeds the `AddSystemDialog` autocomplete; the caller debounces and the server returns `[]` for queries under 2 chars.

### updateSystemOnServer({ mapId, mapSystemId, patch }): Promise<ActionResult<MapEventPayload>>
PATCH. Intended to be called optimistically (apply locally first, then commit/rollback based on the result).

### removeSystemOnServer({ mapId, mapSystemId }): Promise<ActionResult<MapEventPayload>>
DELETE. Optimistic.

### addNoteOnServer({ mapId, body }): Promise<ActionResult<MapEventPayload>>
POST `/api/map/{mapId}/notes`. Create a free-standing note. Returns the `note.created` payload — await-then-apply (or optimistic, MapCanvas's choice). `body` is `CreateNoteBody`.

### updateNoteOnServer({ mapId, noteId, patch }): Promise<ActionResult<MapEventPayload>>
PATCH `/api/map/{mapId}/notes/{noteId}`. Update a note's fields. Optimistic (drag / inspector edits). `patch` is `UpdateNoteBody`.

### deleteNoteOnServer({ mapId, noteId }): Promise<ActionResult<MapEventPayload>>
DELETE `/api/map/{mapId}/notes/{noteId}`. Hard-delete a note. Optimistic.

### createConnectionOnServer({ mapId, body }): Promise<ActionResult<MapEventPayload>>
POST. Await-then-apply.

### updateConnectionOnServer({ mapId, connectionId, patch }) / deleteConnectionOnServer({ mapId, connectionId })
PATCH / DELETE on `/api/map/{mapId}/connections/{connectionId}`. Optimistic.

### restoreConnectionOnServer({ mapId, connectionId }): Promise<ActionResult<RestoreConnectionResult>>
POST `/api/map/{mapId}/connections/{connectionId}/restore` (no body). Re-confirm a dormant wormhole connection and re-activate any hidden endpoint (Stage 4 sig-memory restore). Returns `{ payloads }` (`system.added` per re-activated endpoint, then `connection.create`); the caller iterates `payloads` to register each `eventId` and apply each locally (wrapper-level `eventId` is always `0` — N-events). Used by `MapCanvas`'s restore-connection prompt.

### fetchConnectionMassLog({ mapId, connectionId }): Promise<FetchResult<ConnectionMassLogEntry[]>>
GET `/api/map/{mapId}/connections/{connectionId}/mass-log` (view rights). Lists the connection's
per-jump mass-log oldest-first with a running cumulative mass. Read-only — the log is server-derived;
the `ConnectionMassLog` inspector module refetches on the `connectionMassLog` realtime task.

### deleteSubchainOnServer({ mapId, headMapSystemId, anchorMapSystemId? }): Promise<ActionResult<SubchainDeleteResult>>
POST `/api/map/{mapId}/subchain`. Delete a head system and everything orphaned from the keep-side anchor by removing it. The server recomputes the set authoritatively from `headMapSystemId` (+ `anchorMapSystemId`, the neighbour to keep, only when the map has no Home). Returns `{ summary, payloads }`; the caller iterates `payloads` to register each `eventId` and apply each locally (wrapper-level `eventId` is always `0` — N-events). Used by `MapCanvas`'s delete-subchain handler.

### deleteDisconnectedOnServer({ mapId }): Promise<ActionResult<SubchainDeleteResult>>
POST `/api/map/{mapId}/disconnected` (no body). Delete every visible system with no path back to the map's Home; the server recomputes the set authoritatively. Returns the same `{ summary, payloads }` shape as `deleteSubchainOnServer`. Used by `MapCanvas`'s delete-disconnected handler.

### pingSystemOnServer({ mapId, mapSystemId }): Promise<{ ok: true } | { ok: false; error }>
POST `/api/map/{mapId}/ping`. Broadcast a transient attention "ping" pulse on a system to every map viewer. **Not a mutation** — no `ap_map_event`, no `eventId`, no optimistic apply (returns the minimal `{ ok }` union via `requestJson`, not `ActionResult`). The server fans a `systemNotification` (kind `ping`); the initiator gets its own echo, so the underglow renders for everyone via `MapUnderglowBridge`. Wired to the system context menu's `Ping` item by `MapCanvas`.

### createSignatureOnServer({ mapId, body }) / updateSignatureOnServer({ mapId, signatureId, patch }) / deleteSignatureOnServer({ mapId, signatureId })
POST / PATCH / DELETE on `/api/map/{mapId}/signatures[/{sigId}]`. Create awaits; update/delete are optimistic.

### pasteSignaturesOnServer({ mapId, body }): Promise<ActionResult<BulkPasteResult>>
POST `/api/map/{mapId}/signatures/bulk`. Bulk-diff a paste against the system's existing sigs and commit add / update / remove (+ optional connection tear-down) atomically. Returns `{ summary, payloads }`; the caller iterates `payloads` to register each `eventId` in its dedupe set and apply each payload locally (the wrapper-level `eventId` is always `0` here because bulk is N-events).

### resolveSignaturesOnServer({ mapId, rows }): Promise<FetchResult<ResolvedSigRow[]>>
POST `/api/map/{mapId}/signatures/resolve`. Preview-only resolver for the paste dialog — returns `(groupId, typeId)` for each `ParsedSigRow`. The bulk POST always re-resolves authoritatively, so a stale preview cannot affect the final commit.

### fetchSystemData({ mapId, systemIds }): Promise<FetchResult<SystemDataBatch>>
GET `/api/map/{mapId}/system-data?systems=<id>,<id>,...` (view rights). Returns `SystemDataBatch` (`{ intel, stats, structures }`, the same per-system view-models the page server-renders; `stats`/`structures` sparse). `MapCanvas` calls this to backfill systems added after the initial render and merges the result into its intel/stats/structures state — so sov/FW/incursion decorators and the sidebar modules fill in without a reload.

### fetchSystemSignatures({ mapId, mapSystemId }): Promise<FetchResult<MapSignature[]>>
GET `/api/map/{mapId}/systems/{mapSystemId}/signatures` (view rights; `mapSystemId` is `ap_map_system.id`). Returns the system's current signatures. Signatures no longer ride the `system.added` event (that breached the 8 KB `pg_notify` ceiling); `MapCanvas` calls this on every `system.added` and upserts the result into `viewData.signatures`, so a re-added system's surviving sigs converge on every tab without a reload.

### fetchWormholeTypes({ mapId, universeSystemId }): Promise<ActionResult<WormholeTypeOption[]>>
GET `/api/map/{mapId}/wormhole-types?systemId=<universeSystemId>`. Results are cached per `(mapId, universeSystemId)` in a module-scoped `Map` for the session — WH catalog filtering is immutable per class, so this avoids re-fetching as the user opens the inspector for different systems.

### exportMapOnServer({ mapId }): Promise<FetchResult<MapExportFile>>
GET `/api/map/{mapId}/export` (`map_export` right). Returns the map's current state document; the caller serialises it and triggers the browser download.

### importMapOnServer({ mapId, data }): Promise<ActionResult<ImportResult>>
POST `/api/map/{mapId}/import` (`map_import` right). Merges a `MapExportFile` into the open map and returns the N committed event payloads (wrapper-level `eventId` is `0`); the caller folds each via `applyEvent` and registers its `eventId`.

### fetchTheraConnections({ mapId }): Promise<FetchResult<TheraConnection[]>>
GET `/api/map/{mapId}/thera` (view rights). Lists the current EVE-Scout Thera/Turnur connections; the `TheraModule` computes per-row sync status client-side from live `viewData`.

### syncTheraConnectionsOnServer({ mapId, connections }): Promise<ActionResult<TheraSyncResult>>
POST `/api/map/{mapId}/thera/sync` (`map_update` right). Folds the chosen connections onto the map and returns the N committed event payloads (wrapper-level `eventId` is `0`); the caller folds each via `onBulkPaste` and registers its `eventId`.

### fetchMapSnapshot(mapId: string): Promise<FetchResult<MapViewData>>
GET `/api/map/{mapId}` (view rights). Returns the full authoritative map snapshot — the same `MapViewData` shape `MapCanvas` mounts with. Backs the on-error resync failsafe: `MapCanvas.resync()` calls this when a mutation fails, then `setViewData(data)` + clears the echo-dedupe set. Uses a **bare `fetch`** (not the shared `readFetch`/`requestJson`) so a failed resync does not fire a second `toast.error` on top of the originating mutation's error.

---

### Depends On
- `sonner` (`toast.error`)
- Types from `@/types`: `ActionResult`, `AddSystemResult`, `MapEventPayload`, `WormholeTypeOption`, `BulkPasteOptions`, `BulkPasteResult`, `ParsedSigRow`, `ResolvedSigRow`, `MapExportFile`, `MapViewData`, `ImportResult`, `TheraConnection`, `TheraSyncInput`, `TheraSyncResult`
- Enum value types from `@/lib/map/enumLabels`
