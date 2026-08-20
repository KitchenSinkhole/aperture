## structure_event.ts

**Purpose:** The `ap_structure_event` table — append-only accountability log for manual structure intel (`ap_structure`); one row per create/update/delete, stamped with the acting character.
**File:** `src/db/schema/ap/structure_event.ts`

---

### apStructureEvent
`pgTable('ap_structure_event', …)`:
- `id` — `bigserial` PK.
- `structure_id` — `bigint`, not null. **No FK** — a `delete` event must survive the hard-delete of its `ap_structure` row.
- `system_id` — `integer`, not null. **No FK** — kept decoupled from SDE re-ingest; supports per-system / griefer-by-system audit queries.
- `character_id` — `bigint` FK → `ap_character.id` `ON DELETE SET NULL` (audit actor; erasing a character must not wipe the history row).
- `kind` — `structure_event_kind` enum (`create` | `update` | `delete`), not null.
- `payload` — `jsonb`, nullable. The values written (create/update) or the full pre-delete row snapshot (delete), so deleted intel is recoverable in an audit.
- `scope` — `intel_scope` enum, not null (migration 0070). The parent row's tenancy, denormalized at write time.
- `scope_character_id` — `bigint` FK → `ap_character.id` `ON DELETE SET NULL`, nullable (migration 0070).
- `scope_corporation_id`, `scope_alliance_id` — bare `bigint`, nullable (migration 0070).
- `occurred_at` — `timestamptz`, default `now()`, not null.

**Indexes:** `structure_id` (`ap_structure_event_structure_id_idx`), `character_id` (`ap_structure_event_character_id_idx`, griefer lookup), `(scope, scope_corporation_id, scope_alliance_id, scope_character_id)` (`ap_structure_event_scope_idx`).

**Constraint:** `ap_structure_event_scope_matches_owner_chk` — same shape as `ap_structure`'s: the populated `scope_*` column matches `scope`, at most one is populated, and the all-NULL state is admitted only under `scope='private'`.

### Notes
- Structures carry no `map_id` and so cannot live in `ap_map_event`. This is their dedicated, single-source history — not a parallel audit table to `ap_map_event`. The `structureEventKind` enum lives in `ap/enums.ts`.
- Written by `src/lib/structures/mutations.ts` in the same transaction as the structure-row write.
- **The scope columns are denormalized, not joinable.** `payload` holds the full pre-delete snapshot, so an unscoped read of this table returns exactly the intel `ap_structure`'s own filter withholds — and on a `delete` row the parent is gone, which is the case the snapshot exists for. Any read path added here must filter on these columns; there is no read path today.
