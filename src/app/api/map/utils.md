## utils.ts

**Purpose:** Shared guard helpers for the `/api/map/**` route layer — id parsing, map-existence validation, and combined session + rights gates.
**File:** `src/app/api/map/utils.ts`

---

### parseBigInt(s: string): bigint | null
Parses a URL segment as a positive-integer bigint. Returns `null` when the string is not a valid positive integer.

---

### guardMap(rawId: string): Promise<{ mapId: bigint } | null>
Low-level map-existence check — verifies a map exists and is not soft-deleted (`deleted_at IS NULL`). Bypasses per-map rights; only use it from paths that genuinely need that (e.g. pre-session realtime filtering). Returns `{ mapId }` on success, or `null` otherwise.

---

### requireMapMutate(rawMapId, session, right): Promise<MapAccessGuard>
Combined session + parse + view + right check for write endpoints — every mutation under `/api/map/**` runs this before touching the DB. Discriminated result: `{ ok: true, mapId, characterId }` or `{ ok: false, status: 400|401|403|404, error }`. The 404 case covers both "map does not exist" and "you cannot see this map" so existence is not leaked. Note the right tiers (see `rights.md`): `'map_update'` resolves to **view** authority (content editing is open to every viewer), so those routes never 403; the management rights (`'map_import'`, `'map_export'`) resolve to `canManageMap` and do.

### requireMapView(rawMapId, session): Promise<MapAccessGuard>
View-only variant for read endpoints. Same shape; never returns 403 (view either passes → 200 or fails → 404).

### requireMapCapability(rawMapId, session, capability): Promise<MapAccessGuard>
Combined session + parse + delegated-capability check for a per-map feature endpoint (audit / webhooks / import / export / delete). Wraps `rights.ts`'s `requireMapCapability` with the id parse. Same `MapAccessGuard` shape: `400` (bad id) / `401` (no session) / `404` (missing or unviewable — no existence leak) / `403` (viewable but the viewer lacks the capability). A manager passes implicitly; a corp title granted the capability in `ap_map_role_access` passes too.
