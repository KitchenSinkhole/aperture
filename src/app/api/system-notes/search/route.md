## route.ts (GET /api/system-notes/search)

**Purpose:** Deployment-wide global system-note search for the notes browser.
**File:** `src/app/api/system-notes/search/route.ts`

---

### GET /api/system-notes/search?q=<text>
Auth: signed-in session resolved to an `IntelViewer` (`resolveIntelViewer`; 401 otherwise). Substring match on note body, system name, or category key via `searchSystemNotes`, newest first, capped server-side (`NOTE_SEARCH_LIMIT`) — the viewer's scope filter runs inside the query, before the cap, so a capped page contains only admitted rows.

**Query:** `q` — trimmed, clipped to 100 chars; under 2 chars returns `{ ok: true, data: [] }` without touching the DB.

**Responses:** `200 { ok: true, data: SystemNoteSearchResult[] }`; `401` not signed in.
