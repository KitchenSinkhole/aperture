## user-api-authorize.test.ts

**Purpose:** DB-free unit tests for the user API access decision, token format, log redaction and auth cache (`src/lib/userApi/authorize.ts`, `src/lib/userApi/token.ts`, `src/lib/log/scrub.ts`).
**File:** `tests/unit/user-api-authorize.test.ts`

### Covers
- `decideUserApiAccess` — table-driven over every row of the decision table (unknown, revoked, expired, deleted map → 401; timed and indefinite block, suspension, API off, no main, main can't view, main fails the login gate, unevaluated standing → 403) plus the allow cases (ended block, ended suspension, future expiry); 401s carry no record; `retryAfterSec` rounds up; rows apply in table order.
- `effectiveUserApiScopes` / `checkUserApiScope` — intersection in enum order; refusal of a scope the map stopped exposing and of one the token lacks.
- Token format — generated shape, hash and display prefix; `parseUserApiBearer` accepts only `Bearer apu_<43>` (scheme case-insensitive).
- `scrubContext` — redacts tokens in nested strings and `Error` messages; `redactUserApiTokens` redacts a token with trailing characters whole.
- `resolveUserApiToken` — TTL hit and reload, cached misses, coalesced concurrent misses, no caching of a rejected load, each invalidation export (and that an unrelated id leaves the entry), no caching of a load in flight across an invalidation, LRU eviction at the size cap.
