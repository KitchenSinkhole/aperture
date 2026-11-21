## map_api_token.ts

**Purpose:** The `ap_map_api_token` table — per-map, read-only user API bearer tokens, each owned by an account.
**File:** `src/db/schema/ap/map_api_token.ts`

---

### apMapApiToken
`pgTable('ap_map_api_token', …)` (migration 0073):
- `id` — `bigserial` PK.
- `map_id` — `bigint`, required, → `ap_map` **CASCADE**.
- `user_id` — `integer`, required, → `ap_user` **CASCADE**. The owning account and the token's authority (not an audit column), so the token goes with the account. A token belongs to an account, never to one of its characters.
- `token_hash` — `text`, required, unique. sha256 hex digest of the raw token; the raw value is shown once at mint and is unrecoverable.
- `token_prefix` — `text`, required. The first characters of the random part, for telling tokens apart in lists.
- `label` — `text`, required.
- `scopes` — `api_scope[]`, required. Fixed at mint. A request is served only for a scope in both this list and the map's `api_scopes`.
- `expires_at` — `timestamptz`, nullable. NULL = no expiry.
- `created_at` — `timestamptz`, default `now()`.
- `last_used_at` — `timestamptz`, nullable; `request_count` — `bigint`, default `0`. Usage counters written in batches, approximate by design.
- `suspended_until` — `timestamptz`, nullable. Abuse-ladder suspension.
- `strike_count` — `integer`, default `0`; `last_strike_at` — `timestamptz`, nullable. Persisted abuse strikes.
- `revoked_at` — `timestamptz`, nullable. Non-null = revoked; not a row delete.
- `revoked_reason` — `api_token_revoke_reason` enum, nullable (`creator` / `manager` / `abuse` / `admin`).
- `revoked_by_character_id` — `bigint`, → `ap_character` **SET NULL** (audit).

Indexes `ap_map_api_token_map_id_idx` on `map_id` and `ap_map_api_token_user_id_idx` on `user_id`.

A token is live when `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.
