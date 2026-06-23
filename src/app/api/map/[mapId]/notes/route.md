## route.ts — POST /api/map/[mapId]/notes

**Purpose:** Create a free-standing note on a map.
**File:** `src/app/api/map/[mapId]/notes/route.ts`

### POST
Creates a note (via `createNote`). Inserts an `ap_map_note` row, sets both attribution columns to the actor, and returns `{ ok, data: <note.created payload>, eventId }`. The payload carries the full node body (incl. resolved creator/last-editor names) so the canvas can render it directly.

**Body:** `{ title: string (1..MAP_NOTE_TITLE_MAX_LENGTH), content?: string|null (≤MAP_NOTE_CONTENT_MAX_LENGTH), severity?: 'neutral'|'green'|'yellow'|'red', positionX: number, positionY: number }`. `severity` defaults to `neutral`, `content` to `null`.

**Access:** `map_update` right (same as renaming a system).

**Responses:** 200 ok, 400 invalid body / mutation error, 401 unauthenticated, 404 map not found.
