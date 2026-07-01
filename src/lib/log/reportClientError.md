## reportClientError.ts

**Purpose:** Browser-side fire-and-forget POST of a captured client error to the `/api/client-errors` ingest route; shared by the error boundary and the window-level error handler.
**File:** `src/lib/log/reportClientError.ts`

---

### reportClientError(report: ClientErrorReport): void
POSTs `report` as JSON to `/api/client-errors` with `keepalive: true` and `credentials: 'same-origin'`. Swallows every failure (network error, JSON failure) and never shows a toast — error reporting must not surface its own failure or loop. `keepalive` lets the report survive an in-flight unload/navigation.

**Parameters:**
- `report.message` — the error message (required).
- `report.stack` — optional error stack.
- `report.componentStack` — optional React component stack (from an error boundary's `componentDidCatch`).
- `report.route` — optional `location.pathname` where the error occurred.

Deliberately not built on `requestJson` (`src/lib/http/fetchJson.ts`), which toasts on failure.

---

### interface ClientErrorReport
`{ message: string; stack?: string; componentStack?: string; route?: string }` — the POST body shape, mirrored by the ingest route's Zod schema.
