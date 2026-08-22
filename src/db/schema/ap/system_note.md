## system_note.ts

**Purpose:** The `ap_system_note` table — global system notes: free-text intel entries on a universe system, shared across maps within the scope that owns them.
**File:** `src/db/schema/ap/system_note.ts`

---

### apSystemNote
`pgTable('ap_system_note', …)`:
- `id` — `bigserial` PK.
- `system_id` — `integer` FK → `universe_system.id` `ON DELETE RESTRICT` (a static system in use must not be deletable).
- `body` — `text`, not null. The free-text note (rendered as markdown).
- `category` — `text`, nullable. Null ⇒ uncategorized (no chip). Plain text, not a pgEnum: the vocabulary is a per-deployment instance setting (`ap_instance.system_note_categories`), validated at the API boundary; a stored value absent from the current vocabulary renders as a neutral chip.
- `locked` — `boolean`, default `false`. A locked note refuses edit/delete server-side until unlocked; anyone the row's scope admits may unlock (accident guard rail — the audit log covers malice).
- `scope` — `intel_scope` enum, not null, plus the `scope_character_id` / `scope_corporation_id` / `scope_alliance_id` triple: who may read and mutate this row, derived from the map it was written on, never from the writer's own affiliation. Exactly one `scope_*` column is non-null and matches `scope` (CHECK `ap_system_note_scope_matches_owner_chk`). `scope_character_id` is FK → `ap_character` `ON DELETE SET NULL`, so an erased character leaves a `private` row admin-only; the corp/alliance ids are bare bigints (not FK targets app-wide). Mirrors `ap_structure`'s tenancy shape.
- `created_by_character_id` / `last_edited_by_character_id` — `bigint` FK → `ap_character.id` `ON DELETE SET NULL` (audit; never cascade-wipe intel when a character is erased). Denormalized attribution so the panel shows creator + last editor without reading the event log.
- `created_at` / `updated_at` — `timestamptz`, default `now()`.

**Indexes:** `system_id` (`ap_system_note_system_id_idx`, the per-system module read); `(scope, scope_corporation_id, scope_alliance_id, scope_character_id)` (`ap_system_note_scope_idx`, the per-viewer visibility filter); `body` gin_trgm_ops (`ap_system_note_body_trgm_idx`, the notes browser's leading-wildcard ILIKE — the migration creates the `pg_trgm` extension).

### Notes
- Keyed on the static system alone (no `map_id`): a note written from any map is readable from every map its scope admits the viewer on, whenever the system is encountered again. Contrast `ap_map_system.intel_notes`, which is per-map.
- A journal of entries, each with its own author and timestamps — not a single per-system blob.
- Every mutation is recorded in `ap_system_note_event` (see `system_note_event.ts`).
