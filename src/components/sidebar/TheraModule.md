## TheraModule

**Purpose:** Always-on sidebar panel listing EVE-Scout's Thera + Turnur connections, with one-click sync onto the open map.
**File:** `src/components/sidebar/TheraModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | `ap_map.id` of the open map (`viewData.map.id`). |
| viewData | MapViewData | yes | Live map state; per-row on-map status is derived from `systems` + `connections`. |
| onBulkPaste | (payloads: MapEventPayload[]) => void | yes | Folds the synced systems/edges onto the canvas (shared with signature paste / import). |

### Renders
A `Card` listing EVE-Scout connections grouped under `Thera` / `Turnur` sub-headers. Each row: a status dot (green = on map, amber = missing), the target system name, its class/security label (coloured via `systemClassColor`), and either a `✓` (on map) or a `+` add button (missing). Header has a link icon (opens https://www.eve-scout.com/ in a new tab), **Sync all** (missing rows), and a refresh button — but no in-card title; the panel name ("Eve-Scout") comes from the surrounding `MapPanelGroup` chrome.

### Behaviour & Interactions
- Always rendered (not gated on a selected system) — Thera connections are global scope.
- Fetches `fetchTheraConnections` on mount + manual refresh (active-guard against stale responses).
- Per-row on-map status is computed client-side: hub + target both placed AND a connection links them. It re-derives automatically as `viewData` changes (own sync echo or a peer's realtime update), so a synced row flips green without a refetch.
- Add / Sync-all POST `…/thera/sync` and fold the returned payloads via `onBulkPaste`.

### Emits / Calls
- `fetchTheraConnections({ mapId })` — list.
- `syncTheraConnectionsOnServer({ mapId, connections })` — fold onto map.
- `onBulkPaste(payloads)` — applies committed events to the canvas.

### Depends On
- `Card` / `Button` UI primitives; `systemClassColor` (`src/components/map/styling.ts`).

### Local State
- `connections: TheraConnection[]`, `status`, `error`, `reload` (refresh counter), `syncing` (disables actions during a sync).
