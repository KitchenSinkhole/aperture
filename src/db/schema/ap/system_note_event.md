## system_note_event.ts

**Purpose:** The `ap_system_note_event` table — append-only accountability log for global system notes (`ap_system_note`); one row per create/update/delete, stamped with the acting character and the row's tenancy.
**File:** `src/db/schema/ap/system_note_event.ts`

---

### apSystemNoteEvent
`pgTable('ap_system_note_event', …)`:
- `id` — `bigserial` PK.
- `note_id` — `bigint`, not null. **No FK** — a `delete` event must survive the hard-delete of its `ap_system_note` row.
- `system_id` — `integer`, not null. **No FK** — kept decoupled from SDE re-ingest; supports per-system / griefer-by-system audit queries.
- `character_id` — `bigint` FK → `ap_character.id` `ON DELETE SET NULL` (audit actor; erasing a character must not wipe the history row).
- `kind` — `system_note_event_kind` enum (`create` | `update` | `delete`), not null.
- `payload` — `jsonb`, nullable. The values written (create; update also carries the full pre-edit snapshot under `previous`) or the full pre-delete row snapshot (delete), so edited and deleted intel stay recoverable in an audit.
- `scope` + `scope_character_id` / `scope_corporation_id` / `scope_alliance_id` — the row's tenancy, denormalized at write time (same shape + CHECK as `ap_system_note`): the payload holds full snapshots, so an unscoped read of this table would return exactly the intel the parent filter withholds — and a `delete` event cannot derive its scope from a parent row that is already gone.
- `occurred_at` — `timestamptz`, default `now()`, not null.

**Indexes:** `note_id` (`ap_system_note_event_note_id_idx`), `character_id` (`ap_system_note_event_character_id_idx`, griefer lookup), the scope quadruple (`ap_system_note_event_scope_idx`).

### Notes
- Notes carry no `map_id` and so cannot live in `ap_map_event`. This is their dedicated, single-source history. The `systemNoteEventKind` enum lives in `ap/enums.ts`.
- Written by `src/lib/system-notes/mutations.ts` in the same transaction as the note-row write.
