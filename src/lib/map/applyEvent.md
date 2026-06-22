## applyEvent.ts

**Purpose:** Pure reducer that applies one realtime `MapEventPayload` to a `MapViewData` snapshot and returns the next state.
**File:** `src/lib/map/applyEvent.ts`

---

### applyEvent(state: MapViewData, payload: MapEventPayload): MapViewData

Dispatches on `payload.kind` and returns a new `MapViewData` without mutating the input. Called on the client inside `MapCanvas.tsx`'s `useState` + `useEffect` event loop.

**Parameters:**
- `state` — current canvas view data (map header, visible systems, connections).
- `payload` — a validated `MapEventPayload` from a `mapUpdate` WS envelope.

**Returns:** A new `MapViewData` with the event applied, or the original `state` reference when the event has no canvas representation (`map.create`, `map.delete`, `map.restore`, `map.purge`).

**Per-kind behaviour:**
- `system.added` — upserts the full system node body into `state.systems` (handles both new placements and re-activations of previously-removed systems). When the payload carries an optional `signatures[]` (re-hydration of a re-added system's surviving sigs — see `buildSystemNode`), each is **upserted** into `state.signatures` (find-by-id replace, else append), not replace-all: `system.removed` already pruned this system's sigs, so only survivors are folded back. The signatures field is stripped from the stored node body.
- `system.removed` — filters the system out of `state.systems` (rows persist server-side at `visible=false`; the canvas just stops showing them), **and** prunes any connections incident to it plus any signatures whose `mapSystemId` matches it. This mirrors `loadMapForView`, which only returns connections whose both endpoints are visible: a hidden system's connection rows persist in the DB but must not stay in the client snapshot, or consumers that iterate `connections`/`signatures` directly (e.g. `SystemOverlay`) keep rendering the orphans (as "Unknown" rows) until the next reload. The DB rows survive and reappear if the system is re-added.
- `system.updated` — merges the patch into the matching system; fields applied: `alias`, `tag`, `intelNotes`, `status`, `locked`, `rallyAt`, `positionX`, `positionY`.
- `connection.create` — upserts the full edge body into `state.connections` (existence-checked by `id`, so a double-delivered event can't produce a duplicate edge / React key collision).
- `connection.update` — merges the patch into the matching connection; `isStatic` and `eolAt` are applied when present (so the static designation and canvas EOL countdown reflect the new state without a refetch).
- `connection.delete` — removes the connection by id, and also removes any signatures whose `mapConnectionId` matches it. This mirrors the `ON DELETE CASCADE` on `ap_map_signature.map_connection_id`: the server emits only a `connection.delete` event while Postgres silently cascade-deletes the linked signature rows, so the reducer must drop them too — otherwise the client keeps an orphaned signature whose DB row is gone, and deleting it later 400s with "Signature not found."
- `map.update` — updates `state.map.name` if present in the patch; other settings flags have no canvas representation.
- `signature.create` — upserts the full signature body into `state.signatures`.
- `signature.update` — when the event carries a `snapshot` (full post-update row), **upserts** it (replace-by-id, else append) so a client missing this sig's baseline materializes it instead of silently no-op'ing. Otherwise falls back to merging the patch into the matching signature by id; only present keys overwrite. Patch fields include `groupKey`, `typeId`, the display-only `wormholeCode` (resolved server-side from `universe_wormhole.name` when `typeId` changes), and `updatedAt`.
- `signature.delete` — removes the signature by id.
- `map.create`, `map.delete`, `map.restore`, `map.purge` — return `state` unchanged. The last two are admin-only events; non-admin viewers never see a soft-deleted map open, so there is no canvas state to reconcile.

### Depends On
- `MapViewData`, `MapSystemNode`, `MapConnectionEdge`, `MapSignature` — types from `@/types`
- `MapEventPayload` — type from `@/lib/realtime/protocol`
