## character_presence.ts

**Purpose:** The `ap_character_presence` table — one row per contiguous stretch a character's WebSocket was connected, the durable source for "was this pilot in Aperture" (docs/plans/integration-presence.md).
**File:** `src/db/schema/ap/character_presence.ts`

---

### apCharacterPresence
`pgTable('ap_character_presence', …)`:
- `id` — `bigserial` PK.
- `character_id` — `bigint`, required. FK → `ap_character.id` `ON DELETE CASCADE` (presence is PII about the character, not map history, matching `ap_map_character_tracking`).
- `corporation_id` — `bigint`, nullable. Snapshot of `ap_character.corporation_id` taken when the session opens, not a live join — the tenant boundary the integration reader filters on. Nullable because the source column is nullable; a null-corp row is invisible to every token.
- `started_at` — `timestamptz`, default `now()`.
- `ended_at` — `timestamptz`, default `now()`. Advanced by the WS heartbeat while the socket is live and stamped a final time on close; "still live" is `ended_at > now() - PRESENCE_LIVE_GRACE_MS`.

**Constraints:**
- `ap_character_presence_interval_ck` — CHECK `ended_at >= started_at`.

**Indexes:**
- `ap_character_presence_character_idx` on `(character_id, started_at DESC)` — the reconnect-adoption lookup and per-character session listing.
- `ap_character_presence_corp_idx` on `(corporation_id, started_at DESC)` — the integration reader's tenant-scoped scan.

**Notes:**
- "Online in Aperture" means an authenticated WebSocket is connected; it says nothing about EVE-onlineness (that's `ap_character.last_online`, an ESI-probe snapshot).
- Sessions are stitched: a reconnect within `PRESENCE_SESSION_GAP_MS` adopts the still-open row instead of opening a second one, so intervals per character never overlap. Written and read by `src/lib/realtime/presenceSessions.ts`.
- Pruned by the `character-cleanup` job past `PRESENCE_RETENTION_DAYS`.
