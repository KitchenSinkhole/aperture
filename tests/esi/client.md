## client.test.ts

**Purpose:** Exercises the ESI client substrate end-to-end with a stubbed `fetch` (no real network) and a mocked DB/crypto for token resolution. Mirrors the `vi.stubGlobal('fetch', …)` posture of `tests/integration/auth-rotation.test.ts`.
**File:** `tests/esi/client.test.ts`

`@/db/client` and `@/lib/crypto` are `vi.mock`ed so the character-auth path is deterministic and DB-free; `tokenRow` (via `vi.hoisted`) drives the seeded character row. Fake timers + `setSystemTime` pin the clock outside (`00:00Z`) or inside (`11:00Z`) the downtime window.

### Cases
- **routes** — `resolveRoute('get_status')` → `{ get, /v1/status/ }`; unknown op throws.
- **decoding** — valid 200 decodes; drifted body → `EsiDecodeError`; URL carries `datasource` + User-Agent.
- **circuit breaker** — 5 consecutive 500s open the breaker; next call → `EsiBreakerOpenError` without sending; after cooldown a success closes it.
- **downtime** — inside the window, failures → `EsiDowntimeError` and the breaker stays closed.
- **error limit** — `x-esi-error-limit-remain: 0` → `EsiRateLimitError` carrying reset seconds.
- **character auth** — Bearer token resolved from the row + attached; missing `characterId` throws.
- **refresh classification** — a forced refresh rejected with a permanent `SsoRefreshError` → `EsiTokenError`; a transient one, an unclassified error, and a failure on the expiry-buffer path (no request leaves) → `EsiTokenTransientError`.
