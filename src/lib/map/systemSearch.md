## systemSearch.ts

**Purpose:** Solar-system name search backing the "add system manually" flow — placing a system on a map without a tracked character jumping into it.
**File:** `src/lib/map/systemSearch.ts`

---

### searchSystems(query: string): Promise<SystemSearchResult[]>
Case-insensitive substring search over `universe_system.name`, joined to constellation + region for display. Returns at most 25 rows ordered prefix-matches-first, then shortest name, then alphabetical (so `jit` → `Jita` ranks ahead of longer incidental matches). `LIKE` metacharacters in the query are escaped so input matches literally. Queries shorter than 2 chars (after trim) return `[]` to avoid scanning the whole universe on the first keystroke.

**Parameters:**
- `query` — raw user input; trimmed internally.

**Returns:** `SystemSearchResult[]` — `{ id, name, security, securityStatus, regionName, constellationName }`. `id` is the EVE solar-system id POSTed to `/api/map/[mapId]/systems`.

---

### type SystemSearchResult
Re-exported from `@/types`. Used by the search route and the `AddSystemDialog` client.
