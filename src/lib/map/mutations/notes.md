## notes.ts

**Purpose:** Note-level map mutations (`create` / `update` / `delete`), each a single `commitMapEvent` call, modelled on `systems.ts`.
**File:** `src/lib/map/mutations/notes.ts`

Notes are hard-deleted (no natural re-add key) and carry **denormalized attribution**: every mutation resolves the acting character's name from `ap_character` and embeds it in the realtime payload so the inspector can show creator + last editor without a roster lookup. The append-only audit trail still lands in `ap_map_event` like every mutation.

---

### createNote(input: CreateNoteInput): Promise<ActionResult<MapEventPayload>>
Insert a free-standing note. Sets both `created_by` and `last_edited_by` to the actor; emits `note.created` carrying the full node body (incl. resolved creator/last-editor names) the canvas needs to render it.

**`CreateNoteInput`:** `{ mapId, characterId, title, content, severity, positionX, positionY }`.

---

### updateNote(input: UpdateNoteInput): Promise<ActionResult<MapEventPayload>>
Update the keys present in `patch`; always stamps `last_edited_by` + `updated_at` (so a drag also refreshes editor attribution). Emits `note.updated` — `title` always rides as the audit descriptor, the changed fields ride conditionally. Throws "Note not found on map." when the `(noteId, mapId)` pair matches no row.

**`UpdateNotePatch`:** `{ title?, content?, severity?, locked?, positionX?, positionY? }` (keyed by presence: `'k' in patch`).
**`UpdateNoteInput`:** `{ mapId, noteId, characterId, patch }`. `noteId` is `ap_map_note.id`.

---

### deleteNote(input: DeleteNoteInput): Promise<ActionResult<MapEventPayload>>
Hard-delete the note row. Emits `note.deleted` carrying `{ id, title }` (title captured pre-delete for the audit trail). Throws "Note not found on map." when no row matches.

**`DeleteNoteInput`:** `{ mapId, noteId, characterId }`.

---

### Reuse
`commitMapEvent` (`core.ts`) is the single commit point — webhook dispatch + `pg_notify` come for free. `resolveCharacterName` is an internal helper joining `ap_character` for the attribution payload.
