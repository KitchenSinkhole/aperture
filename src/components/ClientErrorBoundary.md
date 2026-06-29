## ClientErrorBoundary

**Purpose:** React error boundary around the `(app)` `<main>` that shows a recoverable fallback on a render crash and reports the error to `/api/client-errors`.
**File:** `src/components/ClientErrorBoundary.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| children | ReactNode | yes | The page subtree to protect |

### Renders
Children normally. On a caught error, a centered fallback card ("Something went wrong") with **Try again** (resets the boundary) and **Reload** (`location.reload()`) buttons, sized to sit inside `<main>`. The chrome (header/footer/banner) lives outside this boundary and stays usable.

### Behaviour & Interactions
- `static getDerivedStateFromError()` flips `hasError` to render the fallback.
- `componentDidCatch(error, info)` calls `reportClientError({ message, stack, componentStack, route: location.pathname })` — fire-and-forget, scrubbed server-side.
- **Try again** clears `hasError`, re-rendering children (recovers if the cause was transient).
- Must be a class component — no hook equivalent for the error-boundary lifecycle.

### Emits / Calls
- `reportClientError(...)` — POSTs the captured error to the ingest route.

### Depends On
- `Button` (`@/components/ui/button`), `reportClientError` (`@/lib/log/reportClientError`).

### Local State
- `hasError: boolean` — whether to render the fallback instead of children.
