## MapBehaviorForm

**Purpose:** Behavior-toggle form for the in-map Settings → Behavior tab.
**File:** `src/components/map/manage/MapBehaviorForm.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Target map |
| initialValues | Record<'deleteExpiredConnections'\|'deleteEolConnections'\|'autoEolConnections'\|'trackAbyssalJumps', boolean> | yes | Current toggle state |

### Behaviour & Interactions
- **Estimate EOL from wormhole age** (`autoEolConnections`) is the only switch for the `autoEol` cron. Its description tells the owner the marks are estimates shown on everyone's map until a pilot confirms or clears them, and that they are reaped only when Delete EOL connections is also on.
- Submits all four toggles via `updateMapSettingsAction` (gated by `settings_manage`); toasts success/error, and calls `router.refresh()` on success so the reopened dialog reflects the saved values.
