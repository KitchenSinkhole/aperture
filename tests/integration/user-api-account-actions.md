## user-api-account-actions.test.ts

**Purpose:** Drives the Account Settings API tokens actions (`getAccountApiTokens` and `revokeMapApiToken` in `src/app/(app)/actions/mapApi.ts`) and the set-main action's auth-cache invalidation against real Postgres.
**File:** `tests/integration/user-api-account-actions.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-account-actions
```

Mocks `@/lib/auth`'s `auth()` (the session set via `actAs`) and `next/cache`. Snapshots the live `ap_instance` access mode and user API switch and restores them. Both corps holding characters are instance owners, so every character passes the login gate and `canViewMap` is the only access cause. Seeds an account with a main and an alt in different corps, a second account, and four maps: one the main views, one with the API off, one owned by a corp nobody here belongs to, and one soft-deleted. Ids use a 9738xxxx block.

### Covers
- `getAccountApiTokens` lists every non-revoked token the account owns with its map name and status (`active`, `expired`, `api_disabled`, `lost_access`, `map_deleted`), omits revoked tokens and other accounts' tokens, and never carries the raw token.
- `revokeMapApiToken` from an alt revokes the account's tokens on the unviewable, API-off and deleted maps with reason `creator`, one `api.token_revoked` each, with no owner in the payload.
- `setMainCharacterAction` drops the account's cached authorisations: a direct main change leaves a cached allow standing, and the action turns it into `access_lost` on the next call.
- The block reads back with its reason and end for a timed block, and `until: null` for an indefinite one.
