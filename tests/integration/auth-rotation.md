## auth-rotation.test.ts

**Purpose:** Proves the auth security invariants — persisted refresh-token rotation (footgun #2), the classification of a failed refresh, and the JWK refetch cap (footgun #3).
**File:** `tests/integration/auth-rotation.test.ts`

Runs in the `node` environment (`@vitest-environment node`) because it uses `pg` and `node:crypto`.

### refresh-token rotation (real Postgres)
- `beforeAll` applies migrations to the configured `DATABASE_URL` (docker Postgres) and seeds one `ap_user` + `ap_character` with a known encrypted refresh token and an already-expired access token.
- Mocks **only** CCP's token endpoint (`vi.stubGlobal('fetch', …)`) to return a rotated refresh token + new access token.
- Asserts: `refreshAccessToken` returns the new access token, **and** by resolution time the DB row already decrypts to the rotated refresh token + new access token with a future expiry — i.e. persisted before consumed.
- Second test confirms a follow-up refresh sends the *rotated* token, proving the write stuck.
- Four further tests pin `SsoRefreshError.permanent`: a 400 `invalid_grant` body is permanent (and carries the status + error code); a 503, a thrown `fetch`, and a drifted response body are all transient. Every one of them leaves the stored refresh token untouched.

### JWK set refetch cap (footgun #3)
- Stubs `fetch` to return an empty JWK set and resets the cached key set.
- Two verifies of a token with an absent `kid` within the 10s cooldown trigger exactly **one** network fetch.

### Requirements
Needs a reachable Postgres (the docker compose / CI service). `vitest.config.ts` supplies test defaults for `ESI_TOKEN_ENC_KEY` and the auth client envs; `DATABASE_URL` falls back to the local compose connection string.
