## maps.ts (admin server actions)

**Purpose:** Admin actions on `ap_map` rows — the operator's cross-tenant oversight surface at `/admin/maps`. Three operations: soft-delete (sets `deleted_at`), restore (clears `deleted_at`), and purge-now (hard delete that skips the 30-day `map-purge` cron grace). All gated by `isAdmin` (global operator only) — corp Directors / owners, and the corp titles they delegate to, manage their own maps in-place, including settings.
**File:** `src/app/(admin)/actions/maps.ts`

---

### adminSoftDeleteMap(mapId: string): Promise<ActionResult<MapEventPayload>>
Validates the id, gates on `isAdmin`, resolves the map via `selectMap`, then runs `commitMapEvent({ kind: 'map.delete' })` with a `mutate` that sets `deleted_at = now()` on the matching non-deleted row. Returns the same payload shape (`{ kind: 'map.delete', id, deletedAt }`) as the user-facing `deleteMapAction` so downstream subscribers don't need to discriminate by caller. Revalidates `/admin/maps` and `/maps`. Refuses to act on an already-soft-deleted map with a clear error.

### adminRestoreMap(mapId: string): Promise<ActionResult<MapEventPayload>>
Same gate as soft-delete. Clears `deleted_at`, bumps `updated_at`, emits `map.restore` (payload `{ id }`). Refuses to act on a map that is not soft-deleted. Revalidates `/admin/maps` and `/maps`.

### adminPurgeMap(mapId: string): Promise<ActionResult<MapEventPayload>>
**Admin only.** Requires the map to already be soft-deleted (`deleted_at IS NOT NULL`) — active maps must be soft-deleted first.

Transaction ordering inside `db.transaction`:
1. `commitMapEvent({ tx, kind: 'map.purge' })` INSERTs the event; `tg_map_event_notify` queues `pg_notify('map:<id>', payload)`.
2. `DELETE FROM ap_map WHERE id = $1` — cascade removes `ap_map_event` (incl. the row we just inserted), `ap_map_system`, `ap_map_connection`, `ap_map_signature`, `ap_map_webhook`, `ap_map_character_tracking`, and the `ap_map_role_access` rows that reference this map.
3. Commit. Postgres buffers `pg_notify` messages until COMMIT, so the envelope dispatches even though its source `ap_map_event` row is gone.

Returns the synthesized `{ kind: 'map.purge', eventId, id }` payload (the row that backed `eventId` is cascade-removed; we keep the value for client-side dedupe symmetry). Revalidates `/admin/maps` only — soft-deleted maps were already filtered out of `/maps`.

---

### Depends on
- `auth` / `isAdmin` — `@/lib/auth/rights`.
- `commitMapEvent` — `@/lib/map/mutations/core`.
- `apMap` — `@/db/schema`.

### Notes
- These are the operator's global override surfaces. Day-to-day map management (settings, webhooks, audit, delete) is done in-place by owners / corp Directors and the corp titles they delegate to, each surface gated by its own `MapCapability`, not here.
