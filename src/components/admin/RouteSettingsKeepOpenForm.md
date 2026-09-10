## RouteSettingsKeepOpenForm

**Purpose:** Global-admin radio picker for the deployment default dismiss behaviour of the route planner's settings popover — whether an outside click closes it.
**File:** `src/components/admin/RouteSettingsKeepOpenForm.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| initialKeepOpen | boolean | yes | The stored `ap_instance.route_settings_keep_open` value the radio group opens on |

### Renders
A two-option radio group — close on outside click (the default) and keep open until the button is pressed again — each with a one-line explanation, above a Save button. Rendered inside the `/admin/settings` page's Routes section.

### Behaviour & Interactions
- Selection is local until Save; Save posts through `adminSetRouteSettingsKeepOpen` inside a transition, disabling every control while pending.
- Success and failure both surface as a `sonner` toast; the server revalidates `/admin/settings`.
- The value is a default: each account may override it either way from the Routes settings popover.

### Emits / Calls
- `adminSetRouteSettingsKeepOpen({ keepOpen })` — `@/app/(admin)/actions/settings`

### Depends On
- `Button` (`@/components/ui/button`), `toast` (`sonner`)

### Local State
- `keepOpen: boolean` — the currently selected radio
- `pending: boolean` — `useTransition` flag while the action is in flight
