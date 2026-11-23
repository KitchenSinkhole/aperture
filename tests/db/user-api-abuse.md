## user-api-abuse.test.ts

**Purpose:** Drives `applyUserApiStrike` (`src/lib/userApi/abuse.ts`) against real Postgres and checks each transition through `authorizeUserApiBearer`.
**File:** `tests/db/user-api-abuse.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-abuse
```

Snapshots the live `ap_instance` access mode and restores it; the test corp is an instance owner, so the main passes the login gate. Seeds ids in the `9732xxxx` block; each test starts with no tokens, no events on the map and no account block.

### Covers
- One token walked through strikes 1, 2 and 3: `suspended_until`, `strike_count`, `revoked_reason='abuse'`, the account's 7-day block, exactly one `ap_map_event` per transition with the label and neither the owner's name nor the token prefix, and the next request answering `token_suspended`, then 401, with a second token on the account answering `account_blocked`. Each step's tokens are cached just before its strike, so every check lands inside a live cache entry and passes only through the invalidation, not the TTL.
- An indefinite block when the previous block began inside the repeat window; a 7-day block when it began outside it.
- A strike 3 on an already-blocked account revokes and leaves the standing block untouched; the token's own invalidation turns its cached `account_blocked` into 401 on the next request.
- Strike decay restarts at strike 1; a revoked or unknown token writes nothing.
