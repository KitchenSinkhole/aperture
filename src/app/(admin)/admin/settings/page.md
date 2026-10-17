## /admin/settings — Instance settings

**Purpose:** Server component for global-admin-only deployment settings: the instance-wide stale-signature threshold and the Blackout switch with its cleared list.
**File:** `src/app/(admin)/admin/settings/page.tsx`

### Renders
- Page header.
- A "Signature indicators" card with the `<StaleThresholdForm>` (the instance-wide default stale threshold).
- The `<BlackoutPanel>` card, fed by `adminLoadBlackoutPanel()`.

### Behaviour
- Guards on `isAdmin`; non-admin sessions redirect to `/maps` (the `(admin)` layout also gates on `isAdmin`).

### Depends on
- `isAdmin` — `@/lib/auth/rights`; `getGlobalStaleThresholdMinutes` — `@/lib/session`.
- `adminLoadBlackoutPanel` — `@/app/(admin)/actions/blackout`.
- `<StaleThresholdForm>`, `<BlackoutPanel>` — `@/components/admin`.
