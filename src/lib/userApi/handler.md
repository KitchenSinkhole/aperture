## handler.ts

**Purpose:** The one wrapper every `/api/v1/*` route exports through: runs the user API request pipeline in its contracted order and shapes every response.
**File:** `src/lib/userApi/handler.ts`

Authority comes from `Authorization: Bearer` alone; nothing here reads a cookie or a session, which is what makes the open CORS policy carry no ambient authority. `tests/unit/user-api-route-coverage.test.ts` fails any route that does not export through `userApiRoute`.

### Pipeline (`GET`)
1. **Instance switch** (`isUserApiInstanceEnabled`): off answers a bare 404 `{ ok: false, error }` for every endpoint, preflight included.
2. **IP gate** (`checkUserApiIp`, IP from `clientIpOfRequest`, the address `server.ts` resolved): a refusal is 429 `rate_limited` with `Retry-After`.
3. to 5. **Parse, resolve, decide** (`authorizeUserApiBearer`): a 401 for a malformed or unknown token, or for one revoked by the abuse ladder, is reported to `recordUserApiAuthFailure(ip)`. A 401 for any other known token (revoked by a person, expired, map soft-deleted) is not, so one stale client cannot get its IP blocked for every other token behind it. A `token_suspended` refusal counts through `noteUserApiSuspendedRequest`.
6. **Rate limit** (`consumeUserApiRequest`): a refusal is 429 `rate_limited` with `Retry-After`. A request that passes is tallied by `recordUserApiUsage`.
7. **Scope** (`checkUserApiScope`), skipped for an endpoint with no scope: 403 `scope_not_granted`.
8. **Serve**: the endpoint's serve function; a matching `If-None-Match` (weak comparison, list or `*`) answers 304 with no body. If serving throws and the token's map is gone or soft-deleted, the answer is the same 401 as any dead token (not counted as a failed auth) and the map's auth-cache records are dropped; any other error, including a failed liveness read, is logged and answers 500 `server_error` with the usual headers and the request's `RateLimit-*` headers.

Whenever step 4/5 or 6 reports a strike, `applyUserApiStrike(tokenId)` is fired without awaiting.

### Responses
- Success: the serve function's body, `{ ok: true, data, generatedAt }` (plus `hidden: true` on a withheld mass log), with its weak `ETag`.
- Failure: `{ ok: false, error, code }`, `code` a `UserApiErrorCode` (`server_error` on a 500). 401s carry `WWW-Authenticate: Bearer`; `token_suspended` and 429s carry `Retry-After`.
- Every response carries `cache-control: private, no-store`, `x-robots-tag: noindex`, `Access-Control-Allow-Origin: *` and the exposed-header list. Responses from step 6 onward, other than a 401, carry `RateLimit-Limit` and `RateLimit-Remaining` for one budget (the cap that refused a 429, otherwise whichever of the token's, account's and whole API's budget has the fewest requests left) and `RateLimit-Reset`; earlier refusals have no token budget to report.
- `OPTIONS` answers a 204 preflight allowing `GET` with `Authorization` and `If-None-Match`.
- `user_api_requests_total{endpoint,outcome}` is tallied for every `GET` response except the instance-switch 404; preflights are not counted. `http_requests_total` comes from `withApiMetrics` under the template `/api/v1/<endpoint>`.

---

### userApiRoute(endpoint: UserApiEndpoint, scope: ApiScope | null, serve: UserApiServe): UserApiRouteHandlers
The `GET` and `OPTIONS` handlers of one route. `scope` is the scope the endpoint reads, or null for one any live token may call.

---

### serveUserApiProjection(resource: UserApiResource): UserApiServe
Serves `getUserApiProjection(record.map.id, resource, record.access.blackout)` unchanged: its cached `body` and `etag`.

### serveUserApiMassLog: UserApiServe
The `mass_log` projection; with `?connection=<id>` its `data` is narrowed to that connection's entries (an id matching nothing gives an empty list), `hidden: true` is carried through, and the narrowed payload gets its own ETag.

### serveUserApiKills: UserApiServe
The `kills` projection narrowed per request: kills at or after `?since=<ISO>` (default `USER_API_KILLS_DEFAULT_SINCE_MS` back, floored at `USER_API_KILLS_MAX_AGE_DAYS` back, capped at now), newest first, at most `?limit=` (default and maximum `USER_API_KILLS_MAX_LIMIT`, minimum 1). An unparseable value takes its default and an out-of-range one its nearest bound; neither is refused. The narrowed payload gets its own envelope and ETag.

### serveUserApiToken: UserApiServe
`UserApiTokenInfo`: the token's map (`id`, `name`), its granted scopes and its effective scopes (`effectiveUserApiScopes`), both in enum order, its expiry, and the per-token and per-account caps with the window in seconds.

---

### Depends On
- `@/lib/log/logger` (a failed serve, logged at `error`).
- `./instance`, `./rateLimit`, `./authorize`, `./abuse` (`applyUserApiStrike`), `./usage` (`recordUserApiUsage`), `./cache` (`getUserApiProjection`).
- `@/lib/http/clientKey`, `@/lib/metrics/httpInstrumentation` (`withApiMetrics`), `@/lib/metrics/registry` (`recordUserApiRequest`).
- Schema: `ap_map` (the liveness check on a failed serve), `api_scope`.
- Types: `UserApiServe` (called only for a record that passed every gate), `UserApiServed`, `UserApiRouteHandlers`.
- `aperture.config` (`USER_API_MAX_PER_TOKEN`, `USER_API_MAX_PER_ACCOUNT`, `USER_API_RATE_WINDOW_MS`, `USER_API_KILLS_DEFAULT_SINCE_MS`, `USER_API_KILLS_MAX_AGE_DAYS`, `USER_API_KILLS_MAX_LIMIT`).
