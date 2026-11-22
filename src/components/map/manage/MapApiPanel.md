## MapApiPanel

**Purpose:** The in-map Settings → API tab: the map's user API switch and scopes for a holder of `api_manage`, every token on the map for them, and the viewer's own tokens with a mint form for every viewer.
**File:** `src/components/map/manage/MapApiPanel.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Map whose API is managed |
| apiEnabled | boolean | yes | The map's live API switch (`MapViewData.map.apiEnabled`) |
| apiScopes | ApiScope[] | yes | The map's live exposed scopes (`MapViewData.map.apiScopes`) |

### Renders
An explainer with a link to the API reference (`docs/api/README.md` on the repository's `master`), then in order: a notice while the operator has the API off instance-wide; the account block banner (reason, and the end time or "until an admin lifts it"); for an `api_manage` holder, the settings form (enable switch, one checkbox per scope with a one-line description of what leaves the map, the pilots and mass-log lines naming pilot names, Save) and a table of every token on the map (Label with its prefix, Owner, Scopes, Last used, Requests, Status, Revoke); then "Your tokens" (Label, Scopes, Expires, Last used, Status, Revoke) and a create form (label, expiry of 30 days / 90 days / 1 year / never, default 90 days, and checkboxes for only the scopes the map exposes). Statuses read as `describeUserApiTokenStatus` words them.

### Behaviour & Interactions
- Loads `getMapApiState(mapId)` on mount (the tab only mounts when selected), after every save, mint and revoke, and whenever the live `apiEnabled` / `apiScopes` props change.
- While mounted it re-reads the state every 15 seconds and when the page becomes visible again, skipping ticks while the page is hidden, so tokens minted, revoked or suspended elsewhere appear; token events reach no socket. A failed background read keeps the state shown and shows no error.
- The create form's scopes come from the live props; the settings form seeds from the fetched state and reseeds when it changes.
- Turning the switch off in the settings form resets and disables the scope checkboxes, since a save that turns the API off cannot also change scopes.
- The create form is disabled, with the reason shown, while the instance or the map has the API off, the map exposes no scope, the account is blocked, or either live-token cap is reached.
- A successful mint opens a one-time reveal dialog with the raw token, a copy button and a statement that it will not be shown again; closing the dialog drops the token from state. The reveal stays mounted through the loading and error states, so a failed reload after a mint does not lose the token.
- Revoke is behind a confirm dialog that states the token cannot be restored.

### Emits / Calls
- `getMapApiState` / `updateMapApiSettings` / `createMapApiToken` (`src/app/(app)/actions/mapApi.ts`).

### Depends On
- `UserApiBlockBanner`, `UserApiRevokeButton`, `describeUserApiTokenStatus`, `formatUserApiDate` (`@/components/userApi/UserApiTokenParts`).
- `Dialog`, `Button`, `Input`, `Select` (`@/components/ui/*`); `sonner` toast.
- `aperture.config` (`GITHUB_CHANGELOG_REPO`, for the reference link).
- `ApiScope`, `MapApiState`, `UserApiTokenListItem` (`@/types`).

### Local State
- `state: MapApiState | null`, `error` — the state request.
- `revealed: string | null` — the just-minted raw token while the reveal dialog is open.
- Settings form: `enabled`, `scopes`. Create form: `label`, `chosen`, `expiry`.
