## user-api-admin-actions.test.ts

**Purpose:** The operator's user API controls against real Postgres with `auth()` mocked: the instance switch (`adminSetUserApiEnabled`) and the account block and lift (`adminBlockUserApi` / `adminLiftUserApiBlock`).
**File:** `tests/integration/user-api-admin-actions.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-admin-actions
```

Snapshots the live `ap_instance` access mode and user API switch and restores them; the test corp owns the instance, so the target's main passes the login gate. Ids use a 9739xxxx block.

### Covers
- All three actions refused to a corp Director, a plain member and an unauthenticated session, with nothing written.
- The switch flips off and on, each change visible to the very next `isUserApiInstanceEnabled` read.
- A manual block requires a reason, is indefinite, covers every character of the account in `listAdminMembers`, and leaves other accounts unmarked; an unknown character is refused.
- A lift ends a timed block now, keeps `api_blocked_at`, clears the members-list badge, and is refused once no block stands.
- Block and lift each drop the account's cached authorisation: a direct write beside the action leaves the cached answer in place, the action's invalidation flips it on the next `authorizeUserApiBearer`.
