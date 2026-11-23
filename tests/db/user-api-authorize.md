## user-api-authorize.test.ts

**Purpose:** Drives `authorizeUserApiBearer` / `checkUserApiScope` (`src/lib/userApi/authorize.ts`) against real Postgres as a token's account, main and map change.
**File:** `tests/db/user-api-authorize.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-authorize
```

Snapshots the live `ap_instance` access mode and restores it; sets `restricted` with both test corps as instance owners, so every seeded character passes the login gate and a corp move or main switch is refused by `canViewMap` alone. Seeds ids in the `9731xxxx` block; each test starts from a fresh live token and a cleared auth cache.

### Covers
- A live token resolves with its map, main and access; an unknown token is 401.
- Revocation is 401 after `invalidateUserApiToken`, and not before it (the cache holds).
- Kicking the main, or moving the main to a corp that cannot view the map (`mainCanView: false` with `mainLoginAllowed: true`), is `access_lost` once the TTL has passed, without any invalidation.
- Switching the account's main to a character that cannot view the map (again with the login gate passing) is `access_lost` after `invalidateUserApiAccount`; an account with no main is `access_lost`.
- Turning the map's API off is `api_disabled` after `invalidateUserApiMap`, and not before it; removing a scope from the map makes `checkUserApiScope` refuse it.
- Blocking the account is `account_blocked` after `invalidateUserApiAccount`; a soft-deleted map is 401.
