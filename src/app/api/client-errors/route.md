## route.ts — POST /api/client-errors

**Purpose:** Ingest a browser-captured client error and persist it as one scrubbed `ap_error_log` row (`source='client'`), feeding the Phase 5 admin graphs and the Phase 6 error-rate alert rule.
**File:** `src/app/api/client-errors/route.ts`

---

### POST(request: NextRequest): Promise<Response>
Body: `{ message, stack?, componentStack?, route? }` (validated with Zod). Flow:
1. `getSession()` → `sessionKey = session?.characterId ?? 'anon'` (tolerates an absent session; the reporter only mounts in `(app)` but the route doesn't hard-fail).
2. Parse JSON (→ 400 `Invalid JSON.`), `safeParse` (→ 400 with the first issue message).
3. `allowClientError(sessionKey)` — drop with **429 `rate_limited`** (no write) when the per-session or global window cap is exceeded.
4. Truncate `message` / `stack` / `componentStack` to the `CLIENT_ERROR_*_MAX_LENGTH` caps, then `getLogger('client').error(message, { stack, componentStack, route, characterId })`. The logger scrubs PII (`scrubContext`) and persists `source='client'` best-effort. UA is never collected or stored.
5. Returns `{ ok: true }` (200). The browser reporter ignores the body; the shape exists for curl/tests.

**Runtime:** `nodejs` (DB pool access via the logger's persist path).

### Depends On
- `getSession` (`@/lib/session`), `getLogger` (`@/lib/log/logger`), `allowClientError` (`@/lib/log/clientErrorRate`), `apertureConfig` caps.
