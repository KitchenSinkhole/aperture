## client.ts

**Purpose:** Browser-side fetch wrappers for the global system-note REST routes.
**File:** `src/lib/system-notes/client.ts`

Unlike the map mutations these carry no `eventId` (notes emit no realtime event): the caller awaits the returned `SystemNote` and splices it into local state directly. Network/error handling + toasts live in `requestJson`.

---

### createSystemNoteOnServer(body: CreateSystemNoteBody): Promise<FetchResult<SystemNote>>
`POST /api/system-notes` with `{ mapId, systemId, body, category?, locked? }` — `mapId` is the map the note is written on; the server derives the row's scope from it.

### updateSystemNoteOnServer(args: { noteId: string; patch: UpdateSystemNoteBody }): Promise<FetchResult<SystemNote>>
`PATCH /api/system-notes/[noteId]` with any of `{ body?, category?, locked? }`.

### deleteSystemNoteOnServer(args: { noteId: string }): Promise<FetchResult<{ id: string }>>
`DELETE /api/system-notes/[noteId]`.

### searchSystemNotesOnServer(query: string): Promise<FetchResult<SystemNoteSearchResult[]>>
`GET /api/system-notes/search?q=…` — note search for the browser (server filters to the viewer's scope, matches body / system name / category). The caller debounces.
