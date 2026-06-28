## layout.tsx (app)

**Purpose:** Authenticated layout — gates the `(app)` tree behind a session and wraps children in page chrome (header/footer) + the toast portal.
**File:** `src/app/(app)/layout.tsx`

### Renders
A `RealtimeProvider` wrapping the chrome: a `LowContrastController` (applies the per-device low-contrast preference to `<html>` on mount), a `ClientErrorReporter` (window-level error capture), the `RealtimeStatusBanner` (degraded-mode), `AppHeader` (active character + roster) above a `<main>` content area, `AppFooter` below, and a `sonner` `Toaster`.

The `<main>` is full-width (no `max-w-*` constraint) so wide pages like the map canvas can fill the viewport; pages that need a narrower box (e.g. `/maps`) wrap their own content in `mx-auto max-w-*`.

`children` is wrapped in a `ClientErrorBoundary` **inside** `<main>` (Phase 7 client error capture): a render crash in the page subtree shows a recoverable fallback while the chrome (banner/header/footer) — which sits outside the boundary — stays usable. `ClientErrorReporter` is mounted outside the boundary so it keeps reporting even when the page subtree has crashed.

### Behaviour & Interactions
- `requireSession()` redirects to `/` when logged out.
- Resolves the active character (`getActiveCharacter`), the account roster (`getAccountCharacters`), the account's main (`getMainCharacterId`), the connection-travel-animation toggle (`getConnectionTravelAnimation`), and the signature-indicator settings (`getSignatureIndicatorAccountSettings`) server-side; redirects to `/` if the active character row is missing. The roster + main id + travel toggle + signature-indicator settings thread through `AppHeader` to the switcher's Account settings dialog.
- The `RealtimeProvider` boots the SharedWorker once for the whole authenticated tree, so the banner and any `useMapSubscription` share one socket.

### Depends On
- `src/lib/session.ts`, `AppHeader`, `AppFooter`, `sonner`, `RealtimeProvider` (`@/lib/realtime/useRealtime`), `RealtimeStatusBanner`, `LowContrastController`, `ClientErrorReporter`, `ClientErrorBoundary`.
