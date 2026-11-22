## AccountApiTokens

**Purpose:** Account Settings' "API tokens" section: every user API token the account owns, on any map, with its status, last use and a revoke button, plus the account's block.
**File:** `src/components/account/AccountApiTokens.tsx`

### Renders
A heading with a hint that tokens are created from a map's Settings → API tab, then: a notice while the operator has the API off instance-wide; the account block banner; and one row per token (label with its prefix, the map's name, the computed status and when it was last used, a revoke button), or "No tokens." when there are none.

### Behaviour & Interactions
- Loads `getAccountApiTokens()` on mount and again after every revoke. The section lives inside the dialog's content, so it loads when Account Settings opens, not on every page.
- Lists tokens on maps the account can no longer view, maps whose API is off and soft-deleted maps, so it is where such a token stays revocable.

### Emits / Calls
- `getAccountApiTokens` (`src/app/(app)/actions/mapApi.ts`); revoke goes through `UserApiRevokeButton`.

### Depends On
- `UserApiBlockBanner`, `UserApiRevokeButton`, `describeUserApiTokenStatus`, `formatUserApiDate` (`@/components/userApi/UserApiTokenParts`).
- `AccountApiState` (`@/types`).

### Local State
- `state: AccountApiState | null`, `error` — the state request.
