## mapRoles.ts

**Purpose:** Server Actions backing a corp map's Roles & Permissions tab — read the owning corp's titles with their delegated capabilities, and grant/revoke a single capability to a title.
**File:** `src/app/(app)/actions/mapRoles.ts`

Both actions are gated by `canManageMap` (delegating a feature is a management act, not itself delegatable). A grant is one `(map_id, role_id, capability)` row in `ap_map_role_access`; `view` is the implicit visibility overlay and is never toggled here. Delegation is corp-map-only in v1 — private/alliance maps report `{ available: false }`.

---

### getMapDelegationState(mapId: string): Promise<ActionResult<MapDelegationState>>
Loads the map, then returns `{ available: false }` for non-`corp` maps (or a corp map with no owning corp). For a corp map, returns `{ available: true, roles }` where each `DelegationRole` is the title (`displayLabel ?? name`) and the capabilities currently granted to it on this map (`view` excluded). Queries `ap_role` (`source='corp_title'` AND `corporation_id = map.owner_corporation_id`, using `ap_role_corporation_id_idx`) left-joined to `ap_map_role_access` for this map, so titles with no grant appear with an empty capability set. Titles are ordered by name.

**Returns:** `{ ok: false, error }` on a bad id, missing map, or non-manager; otherwise `{ ok: true, data: MapDelegationState }`.

---

### setMapDelegation(input): Promise<ActionResult>
`input` = `{ mapId, roleId, capability, enabled }`; `capability` is one of the six delegatable `map_capability` values (`view` is rejected). Re-validates that `roleId` is a `corp_title` of this map's owning corp — a forged id from another corp is rejected. Inserts (`onConflictDoNothing`) or deletes the grant row inside `commitMapEvent`, which writes one `ap_map_event` (`access.granted` / `access.revoked`) naming the title + capability so the change shows in the map audit log and Discord history. No `revalidatePath` — the tab refetches `getMapDelegationState`.

**Returns:** `{ ok: false, error }` on validation / gate / not-found / commit failure; `{ ok: true }` on success.

### Depends On
- `canManageMap` (`@/lib/auth/rights`) — the manager gate for both actions.
- `commitMapEvent` (`@/lib/map/mutations/core`) — the single map-event commit point.
- `requireSession` (`@/lib/session`), `apMap` / `apRole` / `apMapRoleAccess` (`@/db/schema`), `mapCapability` enum (`@/db/schema/ap/enums`).
- `DelegationRole` / `MapDelegationState` (`@/types`).
