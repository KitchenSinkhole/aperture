## MapAuditBrowser

**Purpose:** Interactive surface of the in-map audit console — the filtered, keyset-paginated commit feed.
**File:** `src/components/map/manage/MapAuditBrowser.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Map whose `/api/map/[mapId]/audit` feed is shown |

### Renders
A filter toolbar (actor dropdown, category chips, "Deletions only", date range, search, refresh/auto-refresh), an optional per-actor drill-down summary, the When/Actor/Action/Detail table, and a "Load more" footer.

### Behaviour & Interactions
- Self-contained: fetches `/api/map/[mapId]/audit`; the **actor list rides the first-page response** (`data.actors`, present only when no cursor) and seeds the dropdown — no `actors` prop.
- Filters rebuild the request URL; changing any filter refetches the first page (search debounced 250ms).
- Auto-refresh polls the first page every 3s (hard-coded `AUTO_REFRESH_MS`).
- Clicking an actor (row or avatar) filters to that actor; the summary bar then shows their per-category + destructive breakdown. Actors are the acting character's **account main** — every commit rolls up to the main (one dropdown entry per account, server-side), so a re-homed alt's history reads under the main.
- Fills its parent's height (`flex-1 min-h-0`): the toolbar, summary bar, and "Load more" footer stay fixed (`shrink-0`) while only the feed table scrolls. The table header is `sticky top-0` so it stays visible while scrolling.

### Depends On
- `GET /api/map/[mapId]/audit` (gated by `canManageMap`)
- `ccpImageUrl` for avatars; `AuditActor` / `AuditEventRow` / `ActorSummary` types
