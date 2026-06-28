## client.ts

**Purpose:** The ESI client substrate — one generic entrypoint (`esiCall`) that dispatches an opKey, attaches a character token when required, gates on a per-endpoint circuit breaker, times out, honours ESI error-limit headers, tolerates the CCP downtime window, and Zod-decodes the response. No business logic.
**File:** `src/lib/esi/client.ts`

---

### esiCall<T>(opKey: OpKey, opts: EsiCallOptions<T>): Promise<T>
Thin metrics wrapper around `runEsiCall` (the request logic below): tallies `esi_requests_total{operationId,outcome}` (`recordEsiRequest`) and observes `esi_request_duration_ms{operationId}`. `outcome` is derived from the thrown error type (`success` / `http_error` / `decode_error` / `breaker_open` / `downtime` / `rate_limited` / `token_error`). Latency is observed only when a request actually left the process — `breaker_open` and `token_error` short-circuit before the network, so they're tallied but not timed.

`runEsiCall` resolves `OP_KEYS[opKey]` → swagger route (`resolveRoute`). Gates on `canRequest`; for `auth: 'character'` ops resolves a bearer token via `resolveCharacterToken`. Builds the URL (path-param substitution + `datasource` + query), `fetch`es with a `ESI_REQUEST_TIMEOUT_MS` timeout, then:
- network/timeout error → `EsiDowntimeError` in window (no breaker hit) else `recordFailure` + `EsiHttpError`.
- **401 on a character-auth op → token problem, not endpoint health.** The stored access token was stale / early-invalidated, so esiCall **force-refreshes once** (`forceRefreshCharacterToken` → `refreshAccessToken`, bypassing the expiry buffer) and retries the request. A 401 never calls `recordFailure` (the breaker stays clean). If the refreshed token *still* 401s → `EsiHttpError(operationId, 401, body)` (a transient CCP blip; the poll backs off and survives). If the forced refresh itself fails (dead refresh token) → `EsiTokenError`. The 401 body is currently logged via the structured logger ([[logger]], `source='job'`) at `warn` (TEMP diagnostic — remove after one capture; `warn` is stdout-only, not persisted to `ap_error_log`).
- other non-2xx → checks error budget (`EsiRateLimitError`), then downtime/`EsiHttpError` as above (breaker counted).
- 2xx → `recordSuccess`, then read the body as text; an **empty body (204 from write ops like `setWaypoint`) decodes as `null`** (those callers pass `schema: z.null()`), otherwise `JSON.parse`. Parse through `opts.schema` (`EsiDecodeError` on failure).

Character-auth calls run at most twice (original + one forced-refresh retry); unauthed calls run once.

**EsiCallOptions<T>:** `{ schema, pathParams?, query?, body?, characterId? }`. `characterId` required for character-auth opKeys.

### Error classes
- `EsiBreakerOpenError(operationId)` — breaker open; request not sent.
- `EsiDowntimeError(operationId)` — failure inside CCP downtime window (expected; breaker untouched).
- `EsiRateLimitError(operationId, resetSeconds)` — `x-esi-error-limit-remain` ≤ 0.
- `EsiHttpError(operationId, status, body)` — non-2xx / network / timeout; counted by the breaker.
- `EsiDecodeError(operationId, cause)` — 2xx body failed Zod validation (schema drift).

Every request sends `X-Compatibility-Date: apertureConfig.ESI_COMPATIBILITY_DATE` — the unversioned ESI surface is pinned by compatibility date; without it CCP defaults to `2020-01-01`, which no longer matches the checked-in `openapi.json` routes/decoders.

### Depends On
- `routes.resolveRoute`, `breaker.{canRequest,recordSuccess,recordFailure}`, `downtime.inDowntimeWindow`.
- `@/lib/metrics/registry.recordEsiRequest` for per-request counter/histogram instrumentation.
- `@/lib/log/logger.getLogger('job')` for the TEMP 401 diagnostic.
- `@/lib/auth/eve-provider.refreshAccessToken` + `@/lib/crypto.decryptToken` for token resolution.
- `env.ESI_BASE_URL` / `env.EVE_USER_AGENT`; `apertureConfig.ESI_DATASOURCE` / `ESI_COMPATIBILITY_DATE` / `ESI_REQUEST_TIMEOUT_MS` / `SSO_TOKEN_REFRESH_BUFFER_S`.
