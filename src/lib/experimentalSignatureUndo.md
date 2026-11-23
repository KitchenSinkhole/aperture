## experimentalSignatureUndo.ts

**Purpose:** Serializable signature undo payloads and a runtime executor for the experimental signatures stack.
**File:** `src/lib/experimentalSignatureUndo.ts`

---

### SIGNATURE_DRAG_MIME
`dataTransfer` type for dragging a signature row onto a map connection.

### SignatureUndoPayload
Discriminated union stored in `experimentalPanelUndo` localStorage entries for the signatures panel.

### runSignatureUndoPayload(runtime, payload, direction)
Applies undo or redo for a stored signature payload via the wired runtime callbacks.

### snapshotPatchInverse(prev, patch)
Builds the inverse `UpdateSignatureBody` from a pre-image sig and the forward patch.
