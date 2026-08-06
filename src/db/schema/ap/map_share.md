## map_share.ts

**Purpose:** The `ap_map_share` table — issued public share links (`/live/<token>`), each pinned to one map with its own redaction profile.
**File:** `src/db/schema/ap/map_share.ts`

---

### apMapShare
`pgTable('ap_map_share', …)`:
- `id` — `bigserial` PK.
- `map_id` — `bigint`, required, → `ap_map` **CASCADE**.
- `token` — `text`, required, unique. Server-generated (`generateShareToken`, `src/lib/map/share.ts`), stored raw so it can be re-copied from the management dialog.
- `label` — `text`, required. Operator-facing name, named in audit entries.
- `presence_mode` — `share_presence_mode` enum, default `anonymous`.
- `show_signatures` — `boolean`, default `false`.
- `show_connection_sig_ids` — `boolean`, default `false`. Independent of `show_signatures`.
- `show_bubbles` — `boolean`, default `false` (migration 0066). Publishes the per-end bubbled flags on `ap_map_connection`.
- `expires_at` — `timestamptz`, nullable. NULL = no expiry.
- `revoked_at` — `timestamptz`, nullable. Non-null = revoked; not a row delete.
- `created_by_character_id` — `bigint`, → `ap_character` **SET NULL**.
- `created_at` — `timestamptz`, default `now()`.

Index `ap_map_share_map_id_idx` on `map_id` (per-map "has a live share" lookup).

A share is live when `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())` and the parent map is not soft-deleted. Resolved by `resolveShareToken` (`src/lib/map/share.ts`).
