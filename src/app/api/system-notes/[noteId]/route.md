## route.ts (PATCH / DELETE /api/system-notes/[noteId])

**Purpose:** Edit or remove a global system-note row.
**File:** `src/app/api/system-notes/[noteId]/route.ts`

---

### PATCH /api/system-notes/[noteId]
Auth: `requireSystemNoteMutate(session, noteId)` — row-scoped: only a caller the row's scope admits; outside it the answer is 404, never 403 (no id oracle), and the scope check precedes the lock check. Body (Zod): any of `body` 1–2000, `category` nullable (validated at request time against the `ap_instance.system_note_categories` vocabulary), `locked` boolean; at least one key required. Calls `updateSystemNote` (which also writes an `update` audit event), then `withAuthorName(row)`.

**Responses:** `200 { ok: true, data: SystemNote }`; `400` invalid id / JSON / body / empty patch; `401` not signed in; `404` unknown note id; `409` note is locked (only the bare `{ locked: false }` unlock is accepted while locked).

### DELETE /api/system-notes/[noteId]
Auth: same. Calls `deleteSystemNote` (hard delete; the audit event keeps the full pre-delete snapshot).

**Responses:** `200 { ok: true, data: { id } }`; `400` invalid id; `401` not signed in; `404` unknown note id; `409` note is locked.
