## MapTaggingForm

**Purpose:** Auto-tagging config form for the in-map Settings → Auto-tagging tab.
**File:** `src/components/map/manage/MapTaggingForm.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Target map |
| initialScheme | 'none' \| 'abc' \| '0121' | yes | Current tag scheme |
| initialHomeMapSystemId | string \| null | yes | Current Home `ap_map_system` id |
| initialExemptHomeStatic | boolean | yes | Current ABC home-static exemption |
| systems | { id; name; alias }[] | yes | Visible map systems for the Home picker |

### Behaviour & Interactions
- Submits `tagScheme` + `homeMapSystemId` + `exemptHomeStaticFromTag` via `updateMapSettingsAction` (gated by `canManageMap`); calls `router.refresh()` on success so the reopened dialog reflects the saved values.
- Home picker disabled when scheme is `none`; the exemption checkbox enables only for ABC with a Home set.
- Scheme and Home pickers use the app's `Select` primitive (portalled dark popup) rather than native `<select>` — native option popups are OS-painted and ignore the page `color-scheme` on Windows. The Home picker's "— None —" entry is the empty-string value.

### Depends On
- `Select` (`@/components/ui/select`) — themed single-select for the scheme and Home pickers.
