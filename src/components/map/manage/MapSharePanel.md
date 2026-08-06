## MapSharePanel

**Purpose:** Share-links editor for the in-map Settings → Share links tab — mints, lists, and revokes the public `/live/<token>` links for one map.
**File:** `src/components/map/manage/MapSharePanel.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Map whose share links are managed |

### Renders
An explainer paragraph, a table of non-revoked links (Label / Exposes / Expires / Created by / copy + revoke actions), and a create form below it (label, pilot-presence select, expiry select, and the three disclosure checkboxes). Empty-state line when the map has no links.

### Behaviour & Interactions
- Loads `listShares(mapId)` on mount (the tab only mounts when selected) and reloads after every create and revoke.
- Creating a link copies its URL (`window.location.origin` + `/live/<token>`) to the clipboard immediately — the URL is the point of the action.
- The copy button is hidden on an expired row; a clipboard rejection toasts rather than failing silently.
- Expiry is chosen as a preset duration and sent as hours; the action resolves the absolute timestamp server-side.
- Revoke is behind a confirm dialog that states the link cannot be brought back.
- A link's redaction profile is fixed at mint, so rows are not editable.

### Emits / Calls
- `listShares` / `createMapShare` / `revokeMapShare` — Server Actions in `src/app/(app)/actions/mapShares.ts` (all `share_manage`-gated).

### Depends On
- `Dialog`, `Button`, `Input`, `Select` (`@/components/ui/*`); `sonner` toast.
- `MapShareListItem`, `SharePresenceMode` (`@/types`).

### Local State
- `shares: MapShareListItem[]`, `loading`, `error` — the list request.
- Create form: `label`, `presenceMode`, `showSignatures`, `showConnectionSigIds`, `showBubbles`, `expiry`.
