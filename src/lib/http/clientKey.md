## clientKey.ts

**Purpose:** Shared best-effort caller-IP derivation for the public-facing rate limiters (`X-Forwarded-For` head, falling back to `X-Real-IP`).
**File:** `src/lib/http/clientKey.ts`

---

### clientKeyFromForwardedFor(forwardedFor: string | undefined | null, realIp: string | undefined | null): string
Returns the first `X-Forwarded-For` entry (trimmed), else `realIp`, else `'unknown'`. Callers extract the raw header value themselves — `NextRequest.headers.get(...)` for `/api/public/[token]/snapshot`, a Node `IncomingMessage.headers` lookup (unwrapping the possible `string[]`) for the public WS upgrade handler — so both limiters key off the same precedence without sharing a header API.

**Parameters:**
- `forwardedFor` — raw `X-Forwarded-For` header value, or its absence.
- `realIp` — raw `X-Real-IP` header value, or its absence.

**Returns:** A best-effort client key. Never throws; the caller decides what to do with `'unknown'`.
