## authorize.ts

**Purpose:** Resolves a user API bearer token to an allow or a coded refusal: parse, resolve and decide (request pipeline steps 3 to 5) and the scope check (step 7). Rate limiting, which sits between decide and scope, is not here.
**File:** `src/lib/userApi/authorize.ts`

Resolved records are cached in-process by token hash for `USER_API_AUTH_CACHE_TTL_MS`, misses included, LRU-bounded at `USER_API_AUTH_CACHE_MAX_ENTRIES`; concurrent misses for one hash share one load. Expiry, suspension and account block are evaluated against the clock at decide time, so they never wait on the TTL. Explicit changes call the invalidation exports; changes the server only observes (kick, ban, leaving the corp, a cleared-list edit) apply within the TTL. Every invalidation also stops any load in flight from caching its result. State is a `globalThis` singleton.

No `import 'server-only'`: reached alongside `rights.ts`, `loginGate.ts` and `blackout.ts`, which load under plain Node.

---

### authorizeUserApiBearer(header: string | null | undefined, now?: number): Promise<UserApiDecision>
Steps 3 to 5 for an `Authorization` header value: `parseUserApiBearer`, then `resolveUserApiToken` on its hash, then `decideUserApiAccess`. A malformed header is a 401 with no database read. Every 401 is a failed auth.

---

### decideUserApiAccess(record: UserApiTokenRecord | null, now: Date): UserApiDecision
The pure access decision. First matching row wins:

| Condition | Result |
|---|---|
| no record, revoked, `expires_at <= now`, or map soft-deleted | 401 `invalid_token`, `record: null` |
| account blocked at `now` | 403 `account_blocked` |
| `suspended_until > now` | 403 `token_suspended`, `retryAfterSec` rounded up, at least 1 |
| map `api_enabled` false | 403 `api_disabled` |
| no main, `access` null, main fails `canViewMap`, or main fails the login gate | 403 `access_lost` |
| otherwise | `{ ok: true, record }` |

A 401 never carries the record, so its four causes are indistinguishable.

---

### checkUserApiScope(record: UserApiTokenRecord, scope: ApiScope): UserApiDecision
Step 7: allow when `scope` is in `effectiveUserApiScopes(record)`, else 403 `scope_not_granted`.

---

### effectiveUserApiScopes(record: UserApiTokenRecord): ApiScope[]
The token's own scopes that the map still exposes (`token.scopes ∩ map.apiScopes`), in `api_scope` enum order.

---

### isUserApiAccountBlocked(account: { apiBlockedAt, apiBlockedUntil }, now: Date): boolean
`apiBlockedAt` set and `apiBlockedUntil` either NULL (indefinite) or after `now`.

---

### resolveUserApiToken(hash: string, now?: number, load?: UserApiTokenLoader): Promise<UserApiTokenRecord | null>
The record for a token hash, from cache while a live entry exists, else from `load` (default `loadUserApiTokenRecord`). A rejected load caches nothing and propagates.

**Parameters:**
- `now` — test seam; fixes the entry's expiry and the clock handed to `load`.
- `load` — test seam.

---

### loadUserApiTokenRecord(hash: string, now: Date): Promise<UserApiTokenRecord | null>
One query for the token row with its map, owning account and that account's main; `null` when no token has the hash. A main that is no longer on the account reads as no main. For a token not already dead at `now` it then evaluates `access`: `canViewMap(main, map)`, `isLoginAllowed` on the main's cached corp and alliance (false for a non-active main), and the account's `getBlackoutStatus`. A dead token gets `access: null`.

---

### invalidateUserApiToken(tokenId: bigint): void
Drops the cached record of one token (revoke, suspend).

### invalidateUserApiMap(mapId: bigint): void
Drops every cached record on one map (API switch, scope change).

### invalidateUserApiAccount(userId: number): void
Drops every cached record owned by one account (block, lift, main change).

### clearUserApiAuthCache(): void
Drops every cached record, misses included (the Blackout switch, tests).

---

### Depends On
- `./token` (`parseUserApiBearer`, `hashUserApiToken`).
- `@/lib/auth/rights` (`canViewMap`), `@/lib/auth/loginGate` (`isLoginAllowed`), `@/lib/auth/blackout` (`getBlackoutStatus`).
- Schema: `ap_map_api_token`, `ap_map`, `ap_user`, `ap_character`.
- Types: `UserApiTokenRecord`, `UserApiDecision`, `UserApiErrorCode`, `ApiScope`.
- `aperture.config` (`USER_API_AUTH_CACHE_TTL_MS`, `USER_API_AUTH_CACHE_MAX_ENTRIES`).
