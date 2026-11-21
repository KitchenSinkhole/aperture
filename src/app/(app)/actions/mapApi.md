## mapApi.ts (app actions)

**Purpose:** Server Actions behind the in-map Settings → API tab and the Account Settings API tokens section: read either surface's state, save the map's user API switch and scopes, and mint and revoke per-map read-only bearer tokens.
**File:** `src/app/(app)/actions/mapApi.ts`

---

A token belongs to an account: the session's `userId` owns it and the session character is the audit actor. Wherever an owner is shown or recorded it is the owning account's current main (`ap_user.main_character_id`, when still on that account). The raw token leaves the server once, in the mint result; no event payload carries the token, its hash or its prefix. Every auth-cache invalidation (`src/lib/userApi/authorize.ts`) runs after its transaction commits. No `revalidatePath`: the tab refetches `getMapApiState` after each mutation, and the map header's API state stays live through `applyEvent`.

A token's computed status, shared by every list here, follows the order of the API's own decision: `expired`, `map_deleted` (the map is soft-deleted), `blocked` (the owning account is blocked), `suspended`, `api_disabled` (the map's API is off), then `lost_access` when the account has no active main, or the main fails `canViewMap` or the login gate (`isLoginAllowed`) on the token's map, else `active`. Every list row carries its map's id and name.

### getMapApiState(mapId: string): Promise<ActionResult<MapApiState>>
Gated by `requireMapView`. The instance switch (`isUserApiInstanceEnabled`), the map's `api_enabled` / `api_scopes`, whether the viewer holds `api_manage` (`canUseMapFeature`), the viewer's account block, the account's non-revoked tokens on the map (`ownTokens`), every non-revoked token on the map for an `api_manage` holder (`mapTokens`, else null), and the token caps with the account's live-token count. Lists are newest first and include expired tokens.

### getAccountApiTokens(): Promise<ActionResult<AccountApiState>>
Gated only by `requireSession`: an account may always see its own tokens. The instance switch, the account's block, and every non-revoked token the account owns on any map, including maps its main can no longer view, maps whose API is off and soft-deleted maps, newest first and including expired tokens.

### updateMapApiSettings(input): Promise<ActionResult>
`input` = `{ mapId, enabled, scopes }`. Gated by `requireMapCapability(…, 'api_manage')`. Reads the map row `FOR UPDATE` and commits one event: a flipped switch is `api.enabled` (carrying the saved scopes) or `api.disabled`; a scope edit with the switch unchanged is `api.scopes_changed` (`added`, `removed`); a save that changes nothing commits nothing. A save that turns the API off and also changes the scopes is refused, so `api.disabled` never leaves the client's scopes stale. Scopes are stored deduplicated in `api_scope` enum order. Calls `invalidateUserApiMap` after commit.

### createMapApiToken(input): Promise<ActionResult<{ token: string; tokenId: string }>>
`input` = `{ mapId, label, scopes, expiresInDays }`: `label` 1 to 60 chars, at least one scope, `expiresInDays` one of 30 / 90 / 365 or null for no expiry (the absolute `expires_at` is computed server-side). Gated by `requireMapView`. Refused while the instance switch is off, when the account's main would be `lost_access` on the map (no active main, or the main fails `canViewMap` or the login gate, whichever character the session is on), while the account is blocked (`isUserApiAccountBlocked`), while the map's API is off, for a scope the map does not expose, and at `USER_API_MAX_TOKENS_PER_ACCOUNT_PER_MAP` live tokens on the map or `USER_API_MAX_TOKENS_PER_ACCOUNT` across every map. The block, map and cap checks run under a lock on the account row, so concurrent mints cannot pass a cap together. Inserts the row from `generateUserApiToken` and commits `api.token_created` (`tokenId`, `label`, `scopes`, `expiresAt`). **Returns:** the raw token, the only time it is ever returned.

### revokeMapApiToken(tokenId: string): Promise<ActionResult>
The owning account may always revoke its own token (`revoked_reason='creator'`), whatever its current access to the map and whether or not the map is soft-deleted; anyone else needs `api_manage` on the token's map (`'manager'`). Sets `revoked_at`, `revoked_reason` and `revoked_by_character_id` and commits `api.token_revoked` (`tokenId`, `label`, `reason`) in one transaction, then calls `invalidateUserApiToken`. Idempotent: an already-revoked token succeeds without a second event. An unknown id and a token the caller may not revoke return the identical `'API token not found.'`, since token ids are sequential.

### Depends On
- `requireSession` (`@/lib/session`); `requireMapView`, `requireMapCapability`, `canUseMapFeature`, `canViewMap` (`@/lib/auth/rights`); `isLoginAllowed` (`@/lib/auth/loginGate`).
- `commitMapEvent` (standalone for mint; joined-transaction for settings, which re-fires the webhook after commit, and for revoke) and `enqueueWebhookDispatch` (`@/lib/map/mutations/core`).
- `@/lib/userApi/authorize` (`invalidateUserApiMap`, `invalidateUserApiToken`, `isUserApiAccountBlocked`), `@/lib/userApi/instance` (`isUserApiInstanceEnabled`), `@/lib/userApi/token` (`generateUserApiToken`).
- Schema: `ap_map_api_token`, `ap_map`, `ap_user`, `ap_character`; `aperture.config` (`USER_API_MAX_TOKENS_PER_ACCOUNT_PER_MAP`, `USER_API_MAX_TOKENS_PER_ACCOUNT`).
- Types: `MapApiState`, `AccountApiState`, `UserApiTokenListItem`, `UserApiTokenStatus`, `UserApiAccountBlock`, `ApiScope`.
