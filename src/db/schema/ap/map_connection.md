## map_connection.ts

**Purpose:** The `ap_map_connection` table — a link (wormhole, gate, jumpbridge, abyssal) between two map systems.
**File:** `src/db/schema/ap/map_connection.ts`

---

### apMapConnection
`pgTable('ap_map_connection', …)`:
- `id` — `bigserial` PK.
- `map_id` — `bigint` FK → `ap_map.id` `ON DELETE CASCADE`.
- `source_map_system_id` / `target_map_system_id` — `bigint` FK → `ap_map_system.id` `ON DELETE CASCADE` (link dies if either endpoint system is removed).
- `scope` — `connection_scope` enum, required.
- `mass_status` — `wh_mass` enum, default `fresh`.
- `jump_mass_class` — `wh_jump_mass` enum, nullable (only WH links set it).
- `eol_stage` — `eol_stage` enum (`none`/`eol`/`critical`), default `none`. Replaces the earlier `is_eol` boolean (migration 0031); `eol` ≈ 4h warning, `critical` ≈ 1h final stage.
- `preserve_mass`, `is_rolling` — `boolean`, default `false`.
- `is_static` — `boolean`, default `false` (migration 0032). User-designated "this wormhole is the source system's static". A free manual flag, not the read-time catalog match (`staticMatchForConnection`). Drives the ABC home-static exemption (`ap_map.exempt_home_static_from_tag`).
- `eol_at` — `timestamptz`, nullable. Stamped when the *current* `eol_stage` is entered (re-stamped on each stage change); read by the EOL-expiry cron + the countdown.
- `confirmed_at` — `timestamptz`, nullable (migration 0042). "Confirmed by a current sig observation." Set to `now()` on every create (`createConnection`); `removeSystem` NULLs it on incident **`wh`** connections when an endpoint is removed (dormant memory — kept for an in-place restore, hidden from the view). `loadMapForView` loads only rows with a non-null `confirmed_at`. Non-`wh` rows (stargate/jumpbridge/abyssal) are structural and never dormanted. Existing rows were backfilled to `created_at`.
- `created_at` / `updated_at` — `timestamptz`, default `now()`.

**Check:** `source_map_system_id <> target_map_system_id` (`ap_map_connection_no_self_loop`).

Hard-deleted on collapse (no soft-delete); attached `ap_map_signature` rows cascade.
