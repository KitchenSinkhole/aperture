## eve-provider.ts

**Purpose:** The Auth.js v5 custom EVE SSO OAuth2 provider plus the persisted refresh-token rotation function.
**File:** `src/lib/auth/eve-provider.ts`

---

### eveProvider(config?): OAuthConfig<EveProfile>
Builds the `id: 'eve'` OAuth2 provider: authorize/token endpoints from `aperture.config` + `env.AUTH_EVE_SSO_BASE`, scopes from `apertureConfig.ESI_SCOPES`, `checks: ['pkce', 'state']`. EVE has no real userinfo endpoint, so `userinfo.request` verifies the JWT access token via `verifyEveAccessToken`, and `profile()` maps the claims to `{ id, name }`. `userinfo.url` is set to EVE's `/oauth/verify` endpoint only to satisfy @auth/core's config assertion and `as` builder — it is never fetched because `request` takes precedence.

---

### refreshAccessToken(characterId: bigint): Promise<string>
Refreshes a character's ESI access token via CCP's `/v2/oauth/token` (`grant_type=refresh_token`, HTTP Basic client auth). Always rotates (no expiry pre-check — callers decide when to call).

**Serialized per character (load-bearing).** The whole body runs inside a `db.transaction` that first takes a transaction-scoped `pg_advisory_xact_lock(hashtextextended('esi-refresh:'||id, 0))`. The worker location-poll and an open browser session's `jwt` callback both refresh the same character; EVE invalidates a refresh token on exchange, so two *overlapping* refreshes race and the loser gets `invalid_grant` (the recurring sporadic-401 / silent-logout footgun). The lock makes read → exchange → write atomic so the next refresher reads the committed rotated token. Per-character (different characters don't block); the token-endpoint `fetch` is held inside the lock by design (serializing the network exchange is the point), costing one pooled connection per concurrent character for the sub-second round-trip.

**Order of operations (load-bearing):** acquire lock → decrypt stored refresh token → POST → Zod-decode `{ access_token, refresh_token, expires_in }` → **`await` the `UPDATE` that writes the rotated refresh token + new access token** → only then return. The DB write must stay strictly before the return — footgun #2 fix verified by `tests/integration/auth-rotation.test.ts`.

**Returns:** the freshly-issued access token (plaintext, for immediate use by the caller).

**Throws:** if no refresh token is stored, the HTTP call fails, or the response shape drifts. A throw rolls back the transaction (and releases the lock).

**Metrics:** records `esi_token_refresh_total{outcome}` — `missing_token` / `http_error` / `invalid_response` inline at each failure site (before the throw, inside the transaction), `success` only after the transaction commits. No `character_id` label (unbounded).

---

Notes:
- Uses `node:crypto` (via `crypto.ts`) and `pg` — Node runtime only.
- Tokens are written as ciphertext (`encryptToken`); only the returned value is plaintext.
