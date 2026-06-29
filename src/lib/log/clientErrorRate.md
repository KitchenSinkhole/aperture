## clientErrorRate.ts

**Purpose:** In-process per-session + global rate limiter that bounds how many client-error reports the `/api/client-errors` ingest route writes to `ap_error_log`, so a browser render loop can't flood the table.
**File:** `src/lib/log/clientErrorRate.ts`

---

### allowClientError(sessionKey: string, now?: number): boolean
Whether a client-error report from `sessionKey` is accepted right now. Fixed-window counters held on a `globalThis` singleton (survives HMR): when the global window (`CLIENT_ERROR_RATE_WINDOW_MS`) elapses it rolls and the per-session map is cleared, bounding memory. Returns `false` (drop the report) once either the per-session cap (`CLIENT_ERROR_MAX_PER_SESSION`) or the global cap (`CLIENT_ERROR_MAX_GLOBAL`) is exceeded for the current window; otherwise increments both counters and returns `true`.

**Parameters:**
- `sessionKey` — the active character id (or `'anon'`) the report is attributed to.
- `now` — injectable clock for tests; defaults to `Date.now()`.

**Returns:** `true` if the report should be persisted, `false` if it should be dropped (the route answers 429).

No `server-only` import — loadable under the bare test runner.

---

### __resetClientErrorRate(): void
Test seam: clears global + per-session state between cases.
