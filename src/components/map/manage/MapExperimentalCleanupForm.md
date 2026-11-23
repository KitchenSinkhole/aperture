## MapExperimentalCleanupForm

**Purpose:** Experimental per-map automatic cleanup toggles for the Settings → Behavior tab (ap_ui).
**File:** `src/components/map/manage/MapExperimentalCleanupForm.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Target map |
| initialValues | Record | yes | `experimentalAutoSignatureCleanup` and `experimentalAutoMapCleanup` |

### Behaviour & Interactions
- Persists via `updateMapSettingsAction` into `ap_map.experimental_signature_cleanup` / `experimental_map_cleanup` (same `settings_manage` gate as other behavior toggles).
- Shown only when experimental UI is active and the viewer holds `settings_manage`.

### Depends On
- `experimentalSettingLabel` — appends the Experimental suffix to row labels.