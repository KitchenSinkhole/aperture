## MapCommandPalette

**Purpose:** Experimental UI command palette — fuzzy-filterable map actions and keyboard shortcuts gated behind `ap_ui`.
**File:** `src/components/map/MapCommandPalette.tsx`

### `MapCommandPalette`

**Props:** `open`, `onOpenChange`, `actions` (`MapCommandAction[]`), optional `resolveQueryActions(query)` for query-driven rows (prepended when the filter is non-empty).

**Renders:** A dialog with a filter field and a scrollable list of commands; Enter runs the first match. Closing the dialog (Esc, outside click, after a command, or `Ctrl/Cmd+K` toggle) clears the filter so the next open starts empty.

### `useMapCommandPaletteKeyboard(...)`

Registers document-level shortcuts when `enabled`: `Ctrl/Cmd+K` toggles the palette (including while the palette search field is focused), `?` opens it, `f` fits the map view (skipped when `blockFitKey` is true, e.g. a wormhole is selected and `f` sets Fresh mass), `1`–`4` focus panels, `Esc` closes. Other shortcuts are ignored while focus is in an editable field.

### `shouldMapFitOnFKey(event, blockFitKey)`
Pure helper for whether bare `f` should trigger a map fit.

### `MapCommandAction`

`{ id, label, hint?, keywords?, run }` — one invokable command row.
