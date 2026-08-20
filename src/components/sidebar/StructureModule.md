## StructureModule

**Purpose:** Sidebar module listing manual structure intel for the selected system, with add/edit/delete.
**File:** `src/components/sidebar/StructureModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| system | MapSystemNode \| null | yes | Selected system; null shows the empty state |
| structures | StructureIntel[] | yes | Structures for the selected system (sliced by the parent) |
| mapType | MapType | yes | The open map's type; the dialog names the audience a new row will land in |
| onCreate | (values: StructureFormValues) => void | yes | Add a structure (parent supplies the systemId) |
| onPatch | (structureId: string, values: StructureFormValues) => void | yes | Edit a structure |
| onDelete | (structureId: string) => void | yes | Delete a structure |

### Renders
A `Card` with a right-aligned "Add" button (only when a system is selected) and a list of structure rows (name + scope chip, type, owner, notes, "added by"), each with edit/delete icon buttons. The panel name ("Structures") comes from the surrounding `MapPanelGroup` chrome — no in-card title. The owner line shows the corp's CCP logo (`ccpImageUrl`) when `ownerCorporationId` is set.

### Behaviour & Interactions
- Empty states: "Select a system…" (no system) / "No structures recorded." (none).
- "Add" / edit open the shared `StructureFormDialog` (edit passes `initial`).
- Each row carries an `IntelScopeChip` for its own `scope`. The list can mix tiers: visibility follows the viewer rather than the open map, so a member sees their corp's, their alliance's and their own private rows together. The chip sits on the name line, away from the owner corp's logo line, because the two are unrelated facts that both mention a corporation.
- **Not realtime-synced** — another user's structure edits appear on the next page load (a structure row carries no `map_id`).

### Depends On
- `StructureFormDialog` — create/edit form.
- `IntelScopeChip` — per-row audience pill.

### Local State
- `dialogOpen: boolean`, `editing: StructureIntel | null` (null ⇒ add mode).
