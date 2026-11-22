## UserApiSwitch

**Purpose:** Global-admin card on `/admin/settings` holding the instance-wide switch for the per-map user API (`/api/v1/*`).
**File:** `src/components/admin/UserApiSwitch.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| enabled | boolean | yes | The current `ap_instance.user_api_enabled` |

### Renders
A card titled "User API" with a one-paragraph explanation, then a row stating the current state (on: each map's managers decide; off: every `/api/v1` request answers 404) and a Turn off / Turn on button.

### Behaviour & Interactions
- One click flips the switch, no confirmation; the result is toasted via `sonner` and the page refreshes through the action's `revalidatePath`.

### Emits / Calls
- `adminSetUserApiEnabled({ enabled })` — `@/app/(admin)/actions/settings`.

### Depends On
- `Button` — `@/components/ui/button`.
