## MapRolesForm

**Purpose:** Title × capability matrix for a corp map's Settings → Roles & Permissions tab; lets a manager delegate individual director features to corporation titles.
**File:** `src/components/map/manage/MapRolesForm.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The map whose delegations are edited |

### Renders
A `<table>` with one row per corporation title and one checkbox column per delegatable feature (Audit log, Settings, Webhooks, Share links, Import, Export, Delete). Falls back to a message when delegation is unavailable (non-corp map), the corp has no titles yet, on load error, or while loading.

### Behaviour & Interactions
- Fetches `getMapDelegationState(mapId)` on mount (the tab only mounts when selected); refetches after a failed toggle to revert to server truth.
- Toggling a cell optimistically flips it, then calls `setMapDelegation(mapId, roleId, capability, enabled)`; on failure it toasts the error and reloads. All checkboxes disable while any transition is pending.
- The `view` capability is never shown — it is implied by any feature grant.

### Emits / Calls
- `getMapDelegationState` / `setMapDelegation` — Server Actions in `src/app/(app)/actions/mapRoles.ts` (both `canManageMap`-gated).

### Depends On
- `MapCapability`, `MapDelegationState` (`@/types`); `sonner` toast.
