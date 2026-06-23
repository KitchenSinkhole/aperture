# Map Notes — GitHub Issue #5

**Goal:** Add free-standing **notes** as a first-class, movable/lockable object on the map, replacing the current "rename an inaccessible Jovian system" hack for conveying map-wide context (e.g. "Florida is on lockdown", "save mass via X") to pilots logging in.

## Context

Issue #5: corps currently abuse system renames to broadcast standing intel on the map. The ask is a proper note object that mirrors how systems behave: it can be dragged, locked in place, carries a short title + a longer free-form body with severity coloring, shows who created/last-edited it on selection, and is edited by double-click — just like systems.

The codebase is exceptionally consistent: notes ride the **existing** `ap_map_event` → `pg_notify` → `mapUpdate` realtime path (no new WS task), use the **existing** `commitMapEvent` mutation core, the **existing** optimistic-apply machinery in `MapCanvas`, and the **existing** `applyEvent` reducer. The only genuinely new surface is a parallel `ap_map_note` table + a second xyflow node type.

### Decisions (confirmed with user)
- **Permissions:** view-gated — same `map_update` right as renaming a system (`requireMapMutate(..., 'map_update')`). Anyone who can edit the map can create/edit notes.
- **Shape:** `title` (≤20 chars, the on-node label) + `content` (≤1000 chars, the longer free-form "discoverable" body shown on select/edit).
- **Severity:** new enum `neutral | green | yellow | red` driving the node's border color.
- **Attribution:** denormalized onto the row — `created_by_character_id` + `last_edited_by_character_id` (`ON DELETE SET NULL`), names resolved at load + carried on the realtime payload. Deliberate, documented deviation from the systems pattern (which keeps attribution only in `ap_map_event`); justified because the issue requires showing creator + editor on selection and a jsonb-id audit query would be awkward. The audit log still records every note mutation automatically via `ap_map_event`.
- **Deletion:** hard delete (like `ap_map_connection`) — a note has no natural re-add key, so no `visible` soft-delete column.
- **Create entry point:** pane right-click → "Add note here" (mirrors the pane "Add system" action). No prominent toolbar button — respects the issue's "don't encourage note creation" goal.
- **Out of scope (note explicitly):** map import/export of notes; webhook *rally*-style triggers. Audit-log + Discord *history* descriptions ARE in scope (cheap, and keeps the accountability log honest).

### Data model
New enum `map_note_severity = ['neutral','green','yellow','red']`.

`ap_map_note`:
| column | type | notes |
|---|---|---|
| id | bigserial PK | xyflow node id (as string) |
| map_id | bigint NOT NULL → ap_map ON DELETE CASCADE | |
| position_x / position_y | double precision NOT NULL DEFAULT 0 | |
| title | text NOT NULL | ≤20 enforced app-layer (Zod) |
| content | text | nullable; ≤1000 enforced app-layer |
| severity | map_note_severity NOT NULL DEFAULT 'neutral' | |
| locked | boolean NOT NULL DEFAULT false | mirrors `ap_map_system.locked` |
| created_by_character_id | bigint → ap_character ON DELETE SET NULL | nullable |
| last_edited_by_character_id | bigint → ap_character ON DELETE SET NULL | nullable |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | |

Index on `map_id`. No new trigger — notes ride the existing `tg_map_event_notify` on `ap_map_event`.

New constants in `aperture.config.ts`: `MAP_NOTE_TITLE_MAX_LENGTH: 20`, `MAP_NOTE_CONTENT_MAX_LENGTH: 1000`.

---

## Stage 1 — Schema, migration, types
**Mode:** Accept edits
**Goal:** `ap_map_note` table + enum exist, are exported, and the migration applies cleanly against the dev DB.
**Touches:**
- `src/db/schema/ap/enums.ts` — add `mapNoteSeverity` pgEnum (+ companion `enums.md`).
- `src/db/schema/ap/map_note.ts` (NEW) + `map_note.md` — `apMapNote` table, modeled on `map_system.ts`.
- `src/db/schema/index.ts` — `export * from './ap/map_note';`.
- `src/db/migrations/0044_map_notes.sql` + `0044_map_notes.rollback.sql` + `meta/_journal.json` entry (idx 44, version "7", breakpoints true). **Hand-written** per the migrations-since-0011 convention — do NOT run `db:generate`. The `.sql` does: `CREATE TYPE map_note_severity`, `CREATE TABLE ap_map_note` (+ FKs + index), and `INSERT INTO ap_event_kind (kind, category) VALUES ('note.created','note'),('note.updated','note'),('note.deleted','note')`. Rollback drops them in reverse.
- `aperture.config.ts` — add the two length constants.
- `src/types/index.ts` — re-export `ApMapNote`/`NewApMapNote` (`InferSelectModel`/`InferInsertModel`).

**Reuse:** `src/db/schema/ap/map_system.ts` is the structural template; FK + `ON DELETE` idioms already established there and in `map_event.ts` (the SET NULL audit FK).

**Done when:** migration applies (`pnpm` migrate against dev DB), `pnpm typecheck` green.

## Stage 2 — Server mutations, realtime protocol, API, client, reducer, loader
**Mode:** Accept edits
**Goal:** Full create/update/delete pathway end-to-end on the server + wire, with realtime fanout and client reducer support. No UI yet.
**Touches:**
- `src/lib/realtime/protocol.ts` — import `mapNoteSeverity`; add a `noteBody` (id, title, content, severity, locked, positionX/Y, createdByCharacterId+Name, lastEditedByCharacterId+Name, createdAt, updatedAt) and three variants `note.created` / `note.updated` / `note.deleted` to `mapEventPayloadSchema`; add the three kinds to `MAP_EVENT_KINDS`.
- `src/lib/map/mutations/notes.ts` (NEW) + `.md` — `createNote` / `updateNote` / `deleteNote`, each via `commitMapEvent` (`kind: 'note.*'`, `map_update`). `mutate` writes the row and resolves actor names (join `ap_character`) to embed in the payload; create sets both attribution cols, update sets `last_edited_by` + `updated_at`. Pattern: `src/lib/map/mutations/systems.ts`.
- `src/app/api/map/[mapId]/notes/route.ts` (NEW) + `.md` — `POST` (create). Body Zod: title (≤20), content (≤1000 nullable), severity, positionX/Y.
- `src/app/api/map/[mapId]/notes/[noteId]/route.ts` (NEW) + `.md` — `PATCH` (title/content/severity/locked/positionX/Y) + `DELETE`. Template: the systems `[systemId]/route.ts` (guard via `requireMapMutate(..., 'map_update')`, `parseBigInt`, `{ ok, ... }` shape).
- `src/lib/map/client.ts` — `addNoteOnServer` / `updateNoteOnServer` / `deleteNoteOnServer` + `CreateNoteBody` / `UpdateNoteBody` wire types.
- `src/lib/map/applyEvent.ts` — `note.created` (upsert into `state.notes`), `note.updated` (merge-by-id), `note.deleted` (filter). Mirrors the system cases.
- `src/lib/map/loadMap.ts` — add `MapNote` view type (incl. resolved `createdByName`/`lastEditedByName`); load notes (LEFT JOIN `ap_character` twice for names) in `loadMapForView`; add `notes: MapNote[]` to `MapViewData`. Re-export `MapNote` from `src/types/index.ts`.
- `src/lib/webhooks/formatters.ts` (`describeMapEvent`) + `.md` — add `note.created`/`note.updated`/`note.deleted` cases so the audit log (`src/lib/map/audit.ts` reuses this) and Discord history render note events with intent-level precision (name the title, the severity change, etc.).

**Reuse:** `commitMapEvent` (`src/lib/map/mutations/core.ts`) is the single commit point — webhook dispatch + `pg_notify` come for free. `requireMapMutate` / `parseBigInt` (`src/app/api/map/utils.ts`). The `mutationFetch` helper in `client.ts`.

**Done when:** `pnpm lint && pnpm typecheck && pnpm build` green; a manual `POST`/`PATCH`/`DELETE` against a dev map emits a `mapUpdate` envelope (verify via the realtime path / a second tab once Stage 3 lands).

## Stage 3 — Canvas node + inspector + context menu
**Mode:** Plan mode *(touches `MapCanvas.tsx`, whose node/selection wiring is intricate — review before editing)*
**Goal:** Notes render, drag, lock, create (pane menu), edit (double-click/inspector), delete, and update live across tabs.
**Touches:**
- `src/components/map/styling.ts` + `.md` — `noteSeverityColor(severity)` (neutral grey, green, yellow, red). Reuse the hex idiom already in this file.
- `src/components/map/MapNoteNode.tsx` (NEW) + `.md` — xyflow node: severity-colored border, title label, lock indicator, four connect-less drag handles (notes don't connect). Double-click opens the editor (selects the note → inspector, like systems). Content shown as a tooltip/expanded snippet. Template: `SystemNode.tsx`.
- `src/components/sidebar/InspectorModule.tsx` + `.md` — extend `SelectionRef` (line 46) to `{ kind: 'system' | 'connection' | 'note'; id }`; add a `NoteInspector` sub-view: title input (≤20), content textarea (≤1000), severity select, locked checkbox, read-only "Created by X · Last edited by Y", Remove button (disabled when locked, mirroring systems). New props `onNotePatch` / `onNoteRemove`.
- `src/types/index.ts` — add `{ kind: 'note'; id; x; y }` to `MapContextMenuTarget` (line 523).
- `src/components/map/MapContextMenu.tsx` + `.md` — pane "Add note here" item (`onAddNoteAt`); a `note` target with a severity radio submenu, Locked checkbox, and destructive Delete. New props for the note callbacks + live `notes` array.
- `src/components/map/MapCanvas.tsx` + `.md` — the integration:
  - `nodeTypes` → `{ system: SystemNode, note: MapNoteNode }`; widen the `nodes` state to the system|note node union.
  - Build note nodes from `viewData.notes` and merge into the single `nodes` array in the render-time sync block (add `viewData.notes` to its key); per-node `draggable: !n.locked`.
  - `onNodeDragStop`: branch on `node.type === 'note'` → snap to grid + optimistic `updateNoteOnServer` position (skip the system collision-nudge; notes may overlap).
  - Selection: handle note nodes in `onNodeClick`; feed the `note` selection to `InspectorModule`.
  - `onAddNote(point)` (POST `addNoteOnServer` at the cursor point via `screenToFlowPosition`, fold via `awaitServer`), `onNotePatch` (optimistic `runOptimistic` + `updateNoteOnServer`), `onNoteRemove` (`deleteNoteOnServer`).

**Reuse:** the whole optimistic stack (`runOptimistic` / `awaitServer` / `applyEvent` / `appliedEventIds` dedupe) already exists in `MapCanvas` — notes plug into it unchanged. `screenToFlowPosition` + `findOpenPosition`/`snapToGrid` (`@/lib/map/placement`) already drive manual system placement.

**Done when:** `pnpm lint && pnpm typecheck && pnpm build` green; manual end-to-end verification below passes.

---

## Companion `.md` standing instruction
Every `.ts`/`.tsx` created or modified above gets its companion `.md` written/updated **in the same change** (CLAUDE.md). New files: `map_note.md`, `notes.md` (mutations), the two route `.md`s, `MapNoteNode.md`. Updated: `enums.md`, `index.md` (schema), `protocol.md`, `client.md`, `applyEvent.md`, `loadMap.md`, `formatters.md`, `styling.md`, `InspectorModule.md`, `MapContextMenu.md`, `MapCanvas.md`.

## Verification (end-to-end, after Stage 3)
1. **Migration:** apply `0044` against dev DB; confirm `ap_map_note` + `map_note_severity` exist and the three `note.*` rows are in `ap_event_kind`. Confirm `0044_map_notes.rollback.sql` cleanly reverses.
2. **CI gate:** run the `ci-verifier` agent (`pnpm lint`, `pnpm typecheck`, `pnpm build`).
3. **Live two-tab test** (use `/run` or the `verify` skill): open the same map in two tabs. In tab A: pane right-click → "Add note here", set title + body + severity → note appears in **both** tabs. Drag it → moves live in tab B. Lock it → no longer draggable. Double-click → editor opens; edit content → updates in B; the inspector shows creator (you) + last-editor. Delete → vanishes in both.
4. **Attribution:** have a second character edit the note; confirm "Last edited by" flips to them while "Created by" stays.
5. **Audit:** open the map Audit log (manager) → the create/edit/delete appear with intent-level descriptions naming the note.
6. **Permissions:** confirm a view-only (no `map_update`) session cannot create/edit (server returns the guard error).

**References:** `CLAUDE.md` (mutation pathways, realtime task vocab, lifecycle patterns, companion `.md` rule); companions `map_system.md`, `MapCanvas.md`, `InspectorModule.md`, `MapContextMenu.md`, `src/lib/realtime/protocol.ts`, `src/lib/map/applyEvent.ts`, `src/lib/map/mutations/core.ts`.
