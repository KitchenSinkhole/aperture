## map_note.ts

**Purpose:** The `ap_map_note` table — a free-standing, movable/lockable note placed on a map (no static universe reference).
**File:** `src/db/schema/ap/map_note.ts`

---

### apMapNote
`pgTable('ap_map_note', …)`:
- `id` — `bigserial` PK. Stringified as the xyflow node id.
- `map_id` — `bigint` FK → `ap_map.id` `ON DELETE CASCADE`.
- `position_x` / `position_y` — `double precision`, default `0`. No coordinate clamping (notes may overlap systems and each other).
- `title` — `text`, required. The on-node label; `≤ MAP_NOTE_TITLE_MAX_LENGTH` (20) enforced app-layer (Zod).
- `content` — `text`, nullable. The longer free-form body shown on select/edit; `≤ MAP_NOTE_CONTENT_MAX_LENGTH` (1000) enforced app-layer.
- `severity` — `map_note_severity` enum, default `neutral`. Drives the node border colour.
- `locked` — `boolean`, default `false`. Mirrors `ap_map_system.locked`; a locked note is not draggable and its Remove action is disabled.
- `created_by_character_id` / `last_edited_by_character_id` — `bigint` FK → `ap_character.id` `ON DELETE SET NULL`, both nullable. **Denormalized attribution** (deliberate deviation from the systems pattern) so the inspector can show creator + last editor; names are resolved at load and carried on the realtime payload.
- `created_at` / `updated_at` — `timestamptz`, default `now()`.

**Index:** `ap_map_note_map_id_idx` on `(map_id)`.

**Lifecycle:** hard-delete (like `ap_map_connection`) — no `visible` soft-delete column.

**Realtime/audit:** notes ride the existing `ap_map_event` → `tg_map_event_notify` → `mapUpdate` path; no dedicated trigger. Mutations land as `note.created` / `note.updated` / `note.deleted` event kinds.
