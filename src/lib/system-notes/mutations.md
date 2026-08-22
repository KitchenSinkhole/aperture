## mutations.ts

**Purpose:** Create/update/delete for global system notes; every mutation also writes one `ap_system_note_event` audit row in the same transaction.
**File:** `src/lib/system-notes/mutations.ts`

Notes are manual intel with no `map_id`, so they do NOT go through `commitMapEvent` / `ap_map_event` and emit no realtime event — a plain REST resource. Every audit row carries the row's `scope` triple denormalized (a `delete` event outlives its parent row). Deletes are hard deletes; the audit row carries the full pre-delete snapshot so the intel stays recoverable.

Locking: a locked note rejects every change except the bare unlock (`{ locked: false }` alone) and rejects delete, both by throwing `SystemNoteLockedError`. A lock-only patch matching the current state is an idempotent no-op (current row returned, no event) — a double-click never 409s. Anyone the row's scope admits may toggle the lock — an accident guard rail, not an ownership claim; the audit log covers malice. Scope itself is enforced by the route guard before these run, so a locked row outside the caller's scope 404s rather than 409ing. The lock check reads the row `FOR UPDATE` inside the transaction.

---

### SystemNoteLockedError
Error class thrown when a mutation is rejected because the note is locked. Routes map it to a 409.

---

### createSystemNote(input: CreateSystemNoteInput): Promise<ApSystemNote>
Inserts a note + a `create` audit event (payload: full row snapshot). Returns the new row.

**Parameters:**
- `input` — `{ systemId, body, category?, locked?, scope, characterId }`; `scope` is the `IntelScopeOwner` the caller derived from the map the note is written on; `characterId` stamps both the row's `created_by_character_id` and the audit event.

---

### updateSystemNote(input: UpdateSystemNoteInput): Promise<ApSystemNote | null>
Patches a note — only present keys of `patch` (`body?`, `category?`, `locked?`) change. `updated_at` and `last_edited_by_character_id` stamp only when the patch touches content (`body`/`category`); a pure lock toggle claims no edit attribution. Writes an `update` audit event whose payload carries the patch **and** the full pre-edit snapshot (`{ patch, previous }`) — an edited-away body stays as recoverable as a deleted one. Returns the updated row, or null if the id does not exist (no event written). Throws `SystemNoteLockedError` when locked and the patch is not the bare unlock; a state-matching lock-only patch no-ops.

---

### deleteSystemNote(input: DeleteSystemNoteInput): Promise<ApSystemNote | null>
Hard-deletes a note + a `delete` audit event holding the full pre-delete snapshot. Returns the deleted row, or null if the id did not exist. Throws `SystemNoteLockedError` when locked.
