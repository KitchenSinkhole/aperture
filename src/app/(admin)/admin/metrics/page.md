## AdminMetricsPage

**Purpose:** `/admin/metrics` — in-app history graphs of operational metrics (ESI rate/latency/failure, route-calc latency, tracked characters, system count, server load, job success) over a selectable time range, with zero external infra.
**File:** `src/app/(admin)/admin/metrics/page.tsx`

### Renders
A header with the page title and a 1h / 24h / 7d / 30d range switcher (links setting `?range=`), then `MetricsCharts` for the loaded history.

### Behaviour & Interactions
- `auth()` then `isAdmin(session)`; non-admin redirects to `/maps` (defence in depth — the layout already gates).
- Server component. Reads `range` from `searchParams` (Promise; default `24h`, validated against the known set), calls `loadMetricHistory(range)`, and passes the result to the client chart component. Switching range re-renders the RSC via the search param — no client fetch / API route.

### Depends On
- `auth`, `isAdmin` — `@/lib/auth` / `@/lib/auth/rights`.
- `loadMetricHistory` — `@/lib/metrics/history`.
- `MetricsCharts` — `@/components/admin/MetricsCharts`.
