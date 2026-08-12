## MapBehaviorForm

**Purpose:** Behavior-toggle form for the in-map Settings → Behavior tab.
**File:** `src/components/map/manage/MapBehaviorForm.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Target map |
| initialValues | Record<'deleteExpiredConnections'\|'deleteEolConnections'\|'trackAbyssalJumps', boolean> | yes | Current toggle state |

### Behaviour & Interactions
- Submits all three toggles via `updateMapSettingsAction` (gated by `settings_manage`); toasts success/error, and calls `router.refresh()` on success so the reopened dialog reflects the saved values.
