## /admin/settings — Instance settings

**Purpose:** Server component for global-admin-only deployment settings: the instance-wide stale-signature threshold, the Blackout switch with its cleared list, and the user API switch.
**File:** `src/app/(admin)/admin/settings/page.tsx`

### Renders
- Page header.
- A "Signature indicators" card with the `<StaleThresholdForm>` (the instance-wide default stale threshold).
- The `<BlackoutPanel>` card, fed by `adminLoadBlackoutPanel()`.
- The `<UserApiSwitch>` card, fed by `isUserApiInstanceEnabled()`.

### Behaviour
- Guards on `isAdmin`; non-admin sessions redirect to `/maps` (the `(admin)` layout also gates on `isAdmin`).

### Depends on
- `isAdmin` — `@/lib/auth/rights`; `getGlobalStaleThresholdMinutes` — `@/lib/session`.
- `adminLoadBlackoutPanel` — `@/app/(admin)/actions/blackout`.
- `isUserApiInstanceEnabled` — `@/lib/userApi/instance`.
- `<StaleThresholdForm>`, `<BlackoutPanel>`, `<UserApiSwitch>` — `@/components/admin`.
