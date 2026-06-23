## route.ts — PATCH / DELETE /api/map/[mapId]/notes/[noteId]

**Purpose:** Update or hard-delete a note.
**File:** `src/app/api/map/[mapId]/notes/[noteId]/route.ts`

`[noteId]` is `ap_map_note.id` (the xyflow node id).

### PATCH
Updates the fields present in the body (via `updateNote`); always re-stamps `last_edited_by` + `updated_at`. Returns `{ ok, data: <note.updated payload>, eventId }`.

**Body (all optional):** `{ title?: string (1..MAP_NOTE_TITLE_MAX_LENGTH), content?: string|null (≤MAP_NOTE_CONTENT_MAX_LENGTH), severity?, locked?: boolean, positionX?: number, positionY?: number }`.

### DELETE
Hard-deletes the note (via `deleteNote`). Returns `{ ok, data: <note.deleted payload>, eventId }`.

**Access:** `map_update` right (both verbs).

**Responses:** 200 ok, 400 invalid id / body / mutation error (incl. "Note not found on map."), 401 unauthenticated, 404 map not found.
