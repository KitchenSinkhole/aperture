## token.ts

**Purpose:** Format, generation, hashing and header parsing of per-map user API bearer tokens (`/api/v1/*`).
**File:** `src/lib/userApi/token.ts`

A token is `apu_` followed by `randomBytes(32)` as unpadded base64url (43 characters). Only its sha256 hex digest is stored (`ap_map_api_token.token_hash`).

No `import 'server-only'`: the log scrubber imports it, and the logger chain loads under the job runner's bare tsx.

---

### USER_API_TOKEN_PREFIX
`'apu_'`.

---

### generateUserApiToken(): GeneratedUserApiToken
A fresh token. **Returns:** `{ token, hash, prefix }`: the raw value (shown to the creator once, never persisted), its sha256 hex digest, and the first 6 characters of the random part (`token_prefix`, for telling tokens apart in lists).

---

### hashUserApiToken(raw: string): string
sha256 hex digest of a raw token.

---

### parseUserApiBearer(header: string | null | undefined): string | null
The raw token from an `Authorization` header value, or `null` when the header is absent, uses another scheme, carries anything after the token, or the value is not `apu_` plus exactly 43 base64url characters. The scheme name is case-insensitive. Pure: no database read. There is no query-string fallback.

---

### redactUserApiTokens(text: string): string
`text` with every embedded `apu_` token replaced by `apu_[redacted]`. A run of base64url characters glued to a token's end is redacted with it.
