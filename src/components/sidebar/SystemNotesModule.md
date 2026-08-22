## SystemNotesModule

**Purpose:** Sidebar module for global system notes on the selected system — markdown bodies, scope + category chips with a category filter row, per-note lock, add/edit/delete, and the notes browser.
**File:** `src/components/sidebar/SystemNotesModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| system | MapSystemNode \| null | yes | Selected system; null shows the empty state |
| notes | SystemNote[] | yes | Notes for the selected system (sliced by the parent, newest first) |
| categories | SystemNoteCategoryDef[] | yes | The deployment's vocabulary (`ap_instance.system_note_categories`) |
| enabled | boolean | yes | Whether the viewer belongs to the map's owning entity; false renders the inert guest card |
| mapType | MapType | yes | The open map's type; a new note's scope derives from it server-side |
| onCreate | (values: SystemNoteFormValues) => void | yes | Add a note (parent supplies the systemId) |
| onPatch | (noteId: string, patch: UpdateSystemNoteBody) => void | yes | Edit a note — body/category from the dialog, or a bare lock toggle |
| onDelete | (noteId: string) => void | yes | Delete a note |
| onJumpToSystem | (systemId: number) => void | yes | Focus a system on the current map (from a browser result) |

### Renders
A `Card` with a header search button (opens the notes browser) and — when a system is selected — an "Add" button; then an optional filter row of category chips (only categories present in the list, plus "All"; config order first, then any keys the current config no longer lists), and the note list. Each note row shows its scope chip (`IntelScopeChip`) and category chip (if any), the body rendered as markdown via `NoteContent` (GFM + colour tags), an attribution line (author · age, plus "edited by X" when a later editor differs), and lock / edit / delete icon buttons. When `enabled` is false the whole card is an explanation that notes belong to the map's owning entity — no list, no Add.

### Behaviour & Interactions
- Empty states: "Select a system…" (no system) / "No notes recorded." (none) / "No notes in this category." (filter excludes all).
- The lock button toggles `locked` via `onPatch(id, { locked })`; edit and delete are disabled while locked (the server also rejects them with a 409).
- Clicking a filter chip filters to that category; clicking it again (or "All") clears the filter. Filter state is local and per-panel.
- "Add" / edit open a dialog that names the audience before submit (an `IntelScopeChip` + sentence: a new note takes the open map's scope; an edit shows the row's own, which may differ) — scope is derived, never picked. Below it: a category `Select` (None + the vocabulary), a 2000-char textarea (help text lists the markdown support and colour-tag names), and a Locked checkbox (same idiom as the map-note inspector) — so a note can be created locked or locked/unlocked while editing. Editing a note whose stored category the vocabulary no longer lists coerces the Select to None (the server rejects legacy keys), so saving visibly clears it.
- The category filter resets to "All" when the selected system changes — a chip chosen on one system must not hide another system's notes.
- The category vocabulary arrives via the `categories` prop; chip classes come from a fixed, closed palette record (full literal class strings so Tailwind keeps every colour available). A stored key absent from the current vocabulary renders as a neutral gray chip and still filters.
- A browser result jump closes the browser and calls `onJumpToSystem`.
- A row's audience is its own `scope`, which need not match the open map: the read filter follows the viewer, so a member on a corp map also sees their alliance's rows and their own private ones side by side.
- **Not realtime-synced** — another user's note edits appear on the next page load.

### Emits / Calls
- `onCreate` / `onPatch` / `onDelete` / `onJumpToSystem` as above.

### Depends On
- `NoteContent` (`@/components/map/NoteContent`) — markdown rendering.
- `IntelScopeChip` / `intelScopeAudience` (`./IntelScopeChip`) — the scope chip and audience copy, shared with structures.
- `NOTE_TEXT_COLOR_NAMES` (`@/lib/map/noteMarkdown`) — colour-tag help text.
- `SystemNotesBrowserDialog` — the deployment-wide search dialog.
- `Select` primitives, `Dialog` primitives, `Card`, `Button`.

### Exports
- `SystemNoteFormValues` — `{ body, category, locked }` dialog output.
- `CategoryChip` — the category chip component (takes the vocabulary as a prop; shared with the browser dialog).

### Local State
- `dialogOpen: boolean`, `editing: SystemNote | null` (null ⇒ add mode), `browserOpen: boolean`, `filter: string | null` (plus the previous system id, so the filter resets during render on system switch).
