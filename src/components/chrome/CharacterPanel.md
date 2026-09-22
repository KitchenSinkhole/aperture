## CharacterPanel

**Purpose:** Slide-in `Sheet` (opened from the header character chip) that lets the user choose which of their characters Aperture tracks **on the currently-open map**, add another character via OAuth, open Account settings, or sign out. (per-map-character-tracking plan — tracking selection is per map, not a global flag.)
**File:** `src/components/chrome/CharacterPanel.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| active | `{ id: string; name: string }` | yes | The session's identity character (account main); drives the trigger chip |
| characters | `PanelCharacter[]` | yes | All characters on the account (`id`, `name`, `status`, `authzLevel`) |
| mainCharacterId | `string \| null` | yes | The account's main — rendered as a "main" tag and forwarded to Account settings |
| travelAnimation | boolean | yes | The account's connection-travel-animation toggle, forwarded to Account settings |
| signatureIndicators | SignatureIndicatorAccountSettings | yes | The account's signature-indicator settings, forwarded to Account settings |
| soundPrefs | SoundPrefs | yes | The account's sound preferences, forwarded to Account settings |

### Renders
A trigger button (active character's portrait + name) opening a right-anchored Sheet: one row per character — with a per-map tracking checkbox **when on a map** (none off-map) — then "Add character", "Account settings", and "Sign out". The description names the open map. Also renders the (initially closed) `AccountSettingsDialog`.

### Behaviour & Interactions
- `currentMapId` is derived from the `/map/[[...slug]]` route via `useParams()` (first numeric slug segment), or `null` when not on a map (e.g. `/maps`, admin pages).
- **On a map:** when the Sheet opens, an effect lazy-fetches `getMapTrackingAction(currentMapId)` → `{ mapName, trackedIds }`, seeds `tracking` (checked iff the id is in `trackedIds`) and `mapName`, and records `loadedMapId = currentMapId`. The checkbox gate `loaded` is **derived** (`loadedMapId === currentMapId`), so it re-gates automatically when the map changes while the Sheet stays open — no synchronous setState in the effect. Each **active** row shows a checkbox bound to `tracking[id]`, disabled until `loaded` (and while `pending`). Toggling flips local state optimistically and calls `setCharacterTrackingAction(id, currentMapId, next)` in `useTransition`, reverting on `{ ok: false }` with a `sonner` toast.
- Opening/closing the Sheet (`handleOpenChange`) resets `loadedMapId = null`, so a reopen always waits for a fresh fetch rather than flashing the prior selection.
- **Off a map:** no tracking checkboxes render at all (the roster still shows portraits/names); the description prompts the user to open a map.
- Non-`active` (kicked/banned) characters show their status label instead of a checkbox and are dimmed.
- The account's main is tagged "main" inline.
- "Add character" / "Sign out" are `<form>`s posting `addCharacterAction` / `signOutAction` (both redirect). "Account settings" closes the Sheet and opens `AccountSettingsDialog`.

### Emits / Calls
- `getMapTrackingAction(currentMapId)`, `setCharacterTrackingAction(id, currentMapId, enabled)`, `addCharacterAction()`, `signOutAction()` from `src/app/(app)/actions/character.ts`.

### Depends On
- `Sheet`, `Avatar`, `Button` UI primitives; `sonner` toast; `useParams` (next/navigation).
- `AccountSettingsDialog` — main-character + delete-account surface.

### Local State
- `open: boolean` — Sheet visibility.
- `settingsOpen: boolean` — Account settings dialog visibility.
- `tracking: Record<string, boolean>` — per-map tracking selection, lazy-loaded on open.
- `mapName: string | null` — the open map's display name for the description.
- `loadedMapId: string | null` — the map id the current `tracking` selection was fetched for; `loaded` (gate) is derived as `loadedMapId === currentMapId`.
- `pending` — transition state for an in-flight toggle.

### Notes
- Portrait URLs are built inline against `images.evetech.net`.
- Used by both the app header (`AppHeader`) and the admin header (`(admin)/admin/layout.tsx`).
