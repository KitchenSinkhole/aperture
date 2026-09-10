## /admin/settings — Instance settings

**Purpose:** Server component for global-admin-only deployment settings: the instance-wide stale-signature threshold, the system overlay's fit-columns overflow policy, and the Routes panel settings-popover dismiss default. (The per-corp `ap_corporation_right` matrix editor was retired in the Stage-4 teardown — migration 0041.)
**File:** `src/app/(admin)/admin/settings/page.tsx`

### Renders
- Page header.
- A "Signature indicators" card with the `<StaleThresholdForm>` (the instance-wide default stale threshold).
- A "System overlay columns" card with the `<OverlayFitOverflowForm>` (what gives when a fit-to-content of the overlay's pilot columns is wider than the overlay window).
- A "Routes panel settings" card with the `<RouteSettingsKeepOpenForm>` (whether an outside click dismisses the route planner's settings popover, as a default members may override).

### Behaviour
- Guards on `isAdmin`; non-admin sessions redirect to `/maps` (the `(admin)` layout also gates on `isAdmin`).

### Depends on
- `isAdmin` — `@/lib/auth/rights`; `getGlobalStaleThresholdMinutes` / `getOverlayFitOverflow` / `getGlobalRouteSettingsKeepOpen` — `@/lib/session`.
- `<StaleThresholdForm>`, `<OverlayFitOverflowForm>`, `<RouteSettingsKeepOpenForm>` — `@/components/admin`.
