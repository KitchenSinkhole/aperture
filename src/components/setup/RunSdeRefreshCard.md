## RunSdeRefreshCard

**Purpose:** Client wrapper around `SetupCard` that owns the result-formatting closure for `setupRunSdeRefresh`.
**File:** `src/components/setup/RunSdeRefreshCard.tsx`

### Renders
A `SetupCard` configured to call `setupRunSdeRefresh` and render the result as `"Enqueued job <jobId>."`.

### Notes
- Distinct from [[RunSdeIngestCard]], which re-ingests the pinned `SDE_BUILD`; this one advances to whatever CCP has published latest.
- Server Components can't pass plain function props to client components, so the per-trigger `renderResult` closure lives in this client wrapper rather than the `/setup` page.
