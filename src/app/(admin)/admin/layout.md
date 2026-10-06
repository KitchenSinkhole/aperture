## AdminLayout

**Purpose:** Layout for the `(admin)` route group — gates entry to `authz_level='admin'` (global operator only) and renders a slim admin chrome around every `/admin/*` page.
**File:** `src/app/(admin)/admin/layout.tsx`

### Renders
- A 14-row header with the "Aperture — Admin" title link, a "Leave admin" plain-text link back to `/maps`, and the existing `CharacterPanel`.
- A 6xl-wide main container with the `AdminNav` sidebar on the left and the routed child page on the right.
- `AppFooter` and a `Toaster` mount at the bottom.

### Behaviour & Interactions
- `requireSession()` redirects unauthenticated requests to `/`.
- `isAdmin(session)` redirects non-admin (or kicked/banned) characters to `/maps`. The exact destination doubles as the "Leave admin" target.
- **No `RealtimeProvider`** — admin pages don't subscribe to map channels. If a future admin page needs realtime, mount it locally rather than promoting it here.

### Depends On
- `requireSession`, `getActiveCharacter`, `getAccountCharacters`, `getMainCharacterId`, `getConnectionTravelAnimation`, `getSignatureIndicatorAccountSettings`, `getSoundPrefs` from `@/lib/session` (the last three thread through `CharacterPanel` to Account settings).
- `isAdmin` from `@/lib/auth/rights`.
- `CharacterPanel`, `AppFooter` from `@/components/chrome/*`.
- `AdminNav` from `@/components/admin/AdminNav`.
- `<Toaster />` from `sonner`.
