## system-data/route.ts

**Purpose:** Read-only JSON route returning batched read-side per-system data (intel + activity stats + structure intel) for live-fetching systems added after page load.
**File:** `src/app/api/map/[mapId]/system-data/route.ts`

---

### GET /api/map/[mapId]/system-data?systems=<id>,<id>,...
Returns `{ ok: true, data: { intel, stats, structures } }` for the requested EVE solar-system ids:
- `intel` — `Record<number, SystemIntelSummary>` (sov / FW / incursion / EVE-Scout / links); one entry per requested id.
- `stats` — `Record<number, SystemStatsSummary>` (rolling 24h activity); sparse — absent for systems with no rows.
- `structures` — `Record<number, StructureIntel[]>`; sparse — absent for systems with no structures the caller may see.

**Access:** view-only (`requireMapView`). Existence is not leaked: missing / non-viewable maps return 404.

**Scoping:** `systems` is not checked against the map's own systems, so structure intel is filtered per viewer — `structuresForSystems` takes the guard's `characterId` and returns only rows that character's scope admits. A sweep of 256 arbitrary system ids therefore yields nothing the caller could not already see. `intel` and `stats` are public universe data and carry no such filter.

**Query:** `systems` is a comma-separated list of positive ints; deduped, capped at 256. Empty / all-invalid → 400.

**Why it exists:** the map page server-renders intel/stats/structures only for the systems present at load (`page.tsx` → `intelForSystems` / `statsForSystems` / `structuresForSystems`). Systems added live carry no read-side data, so `MapCanvas` calls this to backfill them (`fetchSystemData` in `src/lib/map/client.ts`) and merges the result into its state — sov/FW/incursion decorators and the sidebar modules then fill in without a reload. Reuses the same three server functions as the page, so the wire shape matches the load-time props exactly.
