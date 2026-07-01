## InspectorModule

**Purpose:** Selection-driven sidebar panel that hosts all editable fields for the currently selected system, connection, or note.
**File:** `src/components/sidebar/InspectorModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| selected | SelectionRef \| null | yes | `{ kind: 'system' \| 'connection' \| 'note', id }` or `null`. |
| viewData | MapViewData | yes | Source of the system / connection / note being edited. |
| onSystemPatch | (mapSystemId, patch: UpdateSystemBody) => void | yes | Issue a PATCH on the system. |
| onSystemRemove | (mapSystemId) => void | yes | DELETE the system (visible=false). |
| onConnectionPatch | (connectionId, patch: UpdateConnectionBody) => void | yes | PATCH the connection. |
| onConnectionDelete | (connectionId) => void | yes | DELETE the connection (hard). |
| onNotePatch | (noteId, patch: UpdateNoteBody) => void | yes | PATCH the note. |
| onNoteRemove | (noteId) => void | yes | DELETE the note (hard). |

### Renders
One of four sub-views:
- **`SystemInspector`** — status select, alias / tag inputs (committed on blur/Enter), intel notes textarea (committed on blur), locked checkbox, rally toggle button (label reads "Set rally" / "Clear rally" depending on current state), "Remove" button. The Remove button is **disabled when the system is locked** (mirrors the server delete guard — issue #157), with an inline "Unlock to remove" hint beside it pointing at the Locked checkbox directly above. Rendered in the compact card size (`<Card size="sm">`) with a tighter `gap-2` row stack. Signatures are now a separate full-width panel below the map (see `SignatureModule`). The card title shows `systemDisplayName(system.systemId, system.name)` — never the alias — and truncates with an ellipsis so a long name doesn't widen the panel at `minW: 1`; the alias remains editable in its own input. The header column is pinned to `minmax(0,1fr)` so the ellipsis survives clicking/focus rather than re-expanding; the title is `select-text` (with `cursor-text`) so the name can be selected and copied (Ctrl+C). Hovering/focusing the title opens a base-ui `Tooltip` showing the raw canonical SDE name (`system.name`), which for Drifter systems differs from the displayed short community name. `systemDisplayName` shows that short name for the five Drifter systems (e.g. "Barbican"); display only, the stored name is unchanged. The same helper feeds the alias-input placeholder.
- **`ConnectionInspector`** — scope / mass / jump-mass / EOL-stage selects (mass labels are `Fresh (>50%)` / `Reduced (<50%)` / `Critical (<10%)` via `WH_MASS_LABELS`; EOL stage is `None` / `EOL (~4h)` / `Critical (~1h)` via `EOL_STAGE_LABELS`), Preserve / Rolling checkboxes, a live "Expires in X" / "EOL expires in X" hint (`ConnectionExpiryHint`, derived from `connectionTimeLeftMs` + `formatRelativeFromMs`, hidden for non-wormhole scopes), the read-only per-jump `ConnectionMassLog` (server-derived cumulative mass), then the "Delete connection" button. Receives `mapId` (from `viewData.map.id`) to feed the mass-log fetch; remounted via `key={connection.id}`.
- **`NoteInspector`** — title input (≤`MAP_NOTE_TITLE_MAX_LENGTH`, committed on blur/Enter; an emptied title reverts to the stored value since it's the on-node label), content textarea (≤`MAP_NOTE_CONTENT_MAX_LENGTH`, committed on blur, emptied → `null`) — **markdown-aware**: a colour-tag hint (lists `NOTE_TEXT_COLOR_NAMES`) and a live `NoteContent` preview render below it whenever the draft is non-empty — severity select (`NOTE_SEVERITIES`/`NOTE_SEVERITY_LABELS`), Locked checkbox, a read-only "Created by X · Last edited by Y" line (resolved names from the denormalized attribution, `—` when null), and a "Remove" button **disabled when the note is locked** (with an inline "Unlock to remove" hint — mirrors `SystemInspector`). Keyed by `note.id`.
- **`EmptyInspector`** — placeholder card prompting the user to select something.

### Behaviour & Interactions
- All edits go through the supplied callbacks; the inspector itself holds no view state beyond the alias / tag / intel-notes drafts and the rally toggle UI.
- `alias`, `tag`, and `intelNotes` are read-write via local drafts seeded from the stored values; each commits on blur (only when the draft differs from the stored value) to avoid a PATCH per keystroke. Alias/tag also commit on Enter (the handler blurs the input). Emptying any field commits `null`.
- Selecting a different system re-seeds all drafts (the sub-view is keyed by `system.id`).
- A jump-mass value of `__none__` maps to `null` on the wire.

### Depends On
- `Select*`, `Card*`, `Button`, `Input` shadcn primitives
- `Tooltip` (`@base-ui/react/tooltip`) for the canonical-name title tooltip
- `connectionTimeLeftMs` (`@/lib/map/connectionState`) + `formatRelativeFromMs` (`@/lib/map/relativeTime`) for the expiry hint
- `ConnectionMassLog` (`@/components/sidebar/ConnectionMassLog`) for the per-jump mass-log block
- Enum value lists from `@/lib/map/enumLabels`
- `systemDisplayName` (`@/lib/eve/drifterSystems`) for the Drifter short-name title/placeholder
- `NoteContent` (`@/components/map/NoteContent`) + `NOTE_TEXT_COLOR_NAMES` (`@/lib/map/noteMarkdown`) for the note content preview + colour-tag hint
- `MapViewData`, `MapSystemNode`, `MapConnectionEdge`, `MapNote` from `@/types`
- `apertureConfig` (`MAP_NOTE_TITLE_MAX_LENGTH`, `MAP_NOTE_CONTENT_MAX_LENGTH`) from `aperture.config`
- Body types from `@/lib/map/client` (`UpdateSystemBody`, `UpdateConnectionBody`, `UpdateNoteBody`)
