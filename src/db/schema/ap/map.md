## map.ts

**Purpose:** The `ap_map` table — the root entity that owns every per-map system, connection, signature, and event.
**File:** `src/db/schema/ap/map.ts`

---

### apMap
`pgTable('ap_map', …)`:
- `id` — `bigserial` PK.
- `scope` — `map_scope` enum, required (which kinds of systems are allowed).
- `type` — `map_type` enum, required (private/corp/alliance).
- `name` — `text`, required.
- `delete_expired_connections`, `delete_eol_connections` — `boolean`, default `true`. Per-map behaviour toggles.
- `track_abyssal_jumps` — `boolean`, default `false` (migration 0069). Abyssal folding is opt-in per map.
- `next_bookmarks` — `jsonb`, default `'[]'`.
- `owner_character_id` — `bigint`, nullable, FK → `ap_character.id` `ON DELETE SET NULL`. Required when `type='private'`; NULL otherwise.
- `owner_corporation_id` — `bigint`, nullable. Required when `type='corp'`; NULL otherwise. No FK to `ap_corporation`.
- `owner_alliance_id` — `bigint`, nullable. Required when `type='alliance'`; NULL otherwise. No FK.
- `tag_scheme` — `tag_scheme` enum, default `none`. Auto-tagging scheme (`none`/`abc`/`0121`).
- `home_map_system_id` — `bigint`, nullable. The map's Home system both tagging schemes calculate from; cannot be deleted while designated (guard in `removeSystem`). FK → `ap_map_system.id` `ON DELETE SET NULL` is **declared in SQL only** (migration 0024) to avoid the `map.ts ↔ map_system.ts` import cycle — same pattern as `ap_user.main_character_id`.
- `exempt_home_static_from_tag` — `boolean`, default `false` (migration 0032). When true (ABC scheme only), the system reached by the Home system's static connection (`ap_map_connection.is_static`) is left untagged; its letter is freed for reclaim. Reconciled by `reconcileHomeStaticExemption`.
- `created_at` / `updated_at` — `timestamptz`, default `now()`.
- `deleted_at` — `timestamptz`, nullable. **Two-phase deletion**: `NULL` = active; non-null = soft-deleted (30-day grace before a cron hard-purge). No `active` boolean per CLAUDE.md lifecycle rule.

**Constraints:**
- `ap_map_owner_matches_type_chk` — `CHECK` (added in migration 0013) enforcing the mutually-exclusive owner column matches `type`. Allows all-NULL rows, which are treated as admin-only by `src/lib/auth/rights.ts`.

Webhook config normalises into `ap_map_webhook`.
