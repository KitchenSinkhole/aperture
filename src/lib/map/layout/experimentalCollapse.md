## experimentalCollapse.ts

**Purpose:** Pure layout transforms for experimental panel collapse — shrink a grid cell to header height and shift items below without persisting geometry.
**File:** `src/lib/map/layout/experimentalCollapse.ts`

---

### `EXPERIMENTAL_COLLAPSED_PANEL_H`
Grid row count for a collapsed experimental panel (header only).

---

### `applyExperimentalPanelCollapse(items, groupId, collapsed, savedHeights): Layout | null`
Mutates the returned layout array for one breakpoint. On collapse, stores the prior `h` in `savedHeights`, sets `h` to `EXPERIMENTAL_COLLAPSED_PANEL_H`, and decreases `y` for every item whose `y` was at or below the pre-collapse bottom edge. On expand, restores `h` from `savedHeights` and shifts those items down by the height delta. Returns `null` when there is nothing to change.

**Parameters:**
- `items` — one breakpoint's RGL layout
- `groupId` — grid item `i` / group id
- `collapsed` — target collapsed state
- `savedHeights` — in-memory map of pre-collapse row heights (not persisted)

**Returns:** Updated layout, or `null`.
