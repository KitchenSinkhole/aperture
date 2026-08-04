## SdeStatusBanner

**Purpose:** Degraded-mode banner for static data — surfaces an out-of-date or failing SDE so no viewer trusts a map classified against a stale universe.
**File:** `src/components/SdeStatusBanner.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| initial | SdeStatus | yes | Server-rendered status from `getSdeStatus()`, so the first paint is already correct. |

### Renders
Nothing while `state === 'ok'`. Otherwise an amber `role="status"` strip in the same slot for both degraded states: "could not be updated" when `failing`, "out of date" when `stale`. Both name the user-visible consequence (recently added systems or gates may be missing).

### Behaviour & Interactions
- Refetches `GET /api/sde-status` on a 15-minute interval and whenever the tab becomes visible. SDE state moves on a daily cadence, so this needs no realtime task name.
- A failed poll is swallowed and leaves the last known status on screen.

### Depends On
- `SdeStatus` type from [[status]].
