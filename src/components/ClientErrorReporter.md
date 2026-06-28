## ClientErrorReporter

**Purpose:** Effect-only component that captures uncaught `window.onerror` exceptions and unhandled promise rejections (the errors a React boundary can't see) and reports them to `/api/client-errors`.
**File:** `src/components/ClientErrorReporter.tsx`

### Renders
Nothing (`return null`) — it only installs window listeners, mirroring `LowContrastController`.

### Behaviour & Interactions
- One `useEffect` registers `window` `error` and `unhandledrejection` listeners on mount and removes them on unmount.
- Skips the cross-origin opaque case (`"Script error."` with no `error`) — no useful payload.
- For each captured error calls `reportClientError({ message, stack?, route: location.pathname })`.
- Mounted just inside `RealtimeProvider`, **outside** `ClientErrorBoundary`, so it keeps reporting even when the page subtree has crashed.

### Emits / Calls
- `reportClientError(...)` — fire-and-forget POST to the ingest route.

### Depends On
- `reportClientError` (`@/lib/log/reportClientError`).
