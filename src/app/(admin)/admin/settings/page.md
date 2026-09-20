## /admin/settings — Instance settings

**Purpose:** Server component for global-admin-only deployment settings. Currently the instance-wide stale-signature threshold. (The per-corp `ap_corporation_right` matrix editor was retired in the Stage-4 teardown — migration 0041.)
**File:** `src/app/(admin)/admin/settings/page.tsx`

### Renders
- Page header.
- A "Signature indicators" card with the `<StaleThresholdForm>` (the instance-wide default stale threshold).

### Behaviour
- Guards on `isAdmin`; non-admin sessions redirect to `/maps` (the `(admin)` layout also gates on `isAdmin`).

### Depends on
- `isAdmin` — `@/lib/auth/rights`; `getGlobalStaleThresholdMinutes` — `@/lib/session`.
- `<StaleThresholdForm>` — `@/components/admin`.
