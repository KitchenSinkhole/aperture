## user-api.test.ts

**Purpose:** End-to-end coverage of the `/api/v1/*` HTTP surface against real Postgres, calling each route handler directly so every request runs the whole `userApiRoute` pipeline.
**File:** `tests/integration/user-api.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api
```

Pins `Date` (fake timers, Date only) to the start of a rate window so no limiter window rolls mid-test, and resets every in-process limiter, usage buffer, projection cache, auth cache and the instance-switch cache around each test. Snapshots the live `ap_instance` access mode and user API switch and restores them; the test corp is an instance owner, so the main passes the login gate and each refusal has one cause. Ids use a 9734xxxx block.

### Covers
- 200 on all seven endpoints with the success envelope, `cache-control: private, no-store`, `x-robots-tag`, open CORS, the `RateLimit-*` headers and a weak ETag; `/token` reports granted and effective scopes and the limits.
- 304 on a matching `If-None-Match` (in a list), still charged against the budget; a non-matching one is 200. `mass-log?connection=` keeps the envelope.
- 401 `invalid_token` with `WWW-Authenticate: Bearer` for a missing, foreign-scheme, malformed, unknown and revoked token, for a cookie-only request, and for a token whose map was just soft-deleted, that last one with no `RateLimit-*` headers.
- The failed-auth IP block: past `USER_API_MAX_AUTH_FAILURES_PER_IP`, unknown tokens and a token the abuse ladder revoked block the IP (a live token there then gets 429 with `Retry-After`), while a token revoked by its creator keeps answering 401 without blocking the IP.
- 500 `server_error` with the CORS, cache and `RateLimit-*` headers when serving throws on a live map, logged at `error` (the logger is mocked).
- 403 `account_blocked`, `token_suspended` (with `Retry-After`), `api_disabled`, `access_lost`, `scope_not_granted`.
- 429 `rate_limited` with `Retry-After` past the per-token cap.
- Ordering: a request for an ungranted scope is charged against the budget (and its usage tallied) before the scope refusal, and is eventually refused 429.
- A token hammering through three hot windows is suspended by the abuse ladder, and its next request is `token_suspended`.
- CORS preflight; 404 for every endpoint and the preflight while the instance switch is off, served again once it is back on. The switch is flipped through the operator's `adminSetUserApiEnabled` action (with `auth()` mocked to an admin seeded beside the main), after a request that caches it, so the case proves the action's invalidation.
