## corp-search/route.ts

**Purpose:** Corporation name autocomplete endpoint for the structure-intel owner picker.
**File:** `src/app/api/structures/corp-search/route.ts`

---

### GET /api/structures/corp-search?q=\<query\>
Returns `{ ok, data: CorpSearchResult[] }` (`{ id, name }[]`). Any signed-in user may call it; the search runs under their own ESI token via `searchCorporations` (`@/lib/structures/corpSearch`). Queries under 3 chars resolve to `[]` without hitting ESI.

**Errors:**
- 401 — not signed in.
- 400 `Sign out and back in…` — the caller's token predates the `esi-search.search_structures.v1` scope (`EsiTokenError` / ESI 401|403).
- 503 — the SSO token endpoint could not be reached to refresh the caller's token (`EsiTokenTransientError`); the token is still valid, so the caller retries rather than re-authenticating.
- 502 — any other ESI failure (breaker open, http, decode).
