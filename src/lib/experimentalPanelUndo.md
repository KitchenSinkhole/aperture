## experimentalPanelUndo.ts

**Purpose:** Per-panel undo stacks for the experimental UI with optional localStorage persistence of serialized inverse payloads (cap 50).
**File:** `src/lib/experimentalPanelUndo.ts`

---

### experimentalUndoPush(panel, cmd)
Pushes a command onto the panel stack (clears that panel's redo branch). Caps depth at `EXPERIMENTAL_UNDO_MAX` (50). When `cmd.serialized` is set, the stack is persisted under `aperture:experimental:undo:v2`.

### experimentalUndoSetExecutor(panel, executor)
Registers a payload runner used to rebuild `undo`/`redo` closures after reload from localStorage.

### experimentalUndoHydrateFromStorage()
Loads stored stacks once executors are wired.

### experimentalUndoPushSignature(...)
Convenience push for the signatures panel using `SignatureUndoPayload` records.

### experimentalUndoApply(panel) / experimentalRedoApply(panel)
Pops and runs `undo` / `redo`. Returns whether an action ran.

### experimentalUndoPanelFromFocus()
Maps the focused DOM node's `data-panel-id` to a stack id (`canvas` → `map`, etc.).
