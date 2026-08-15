## page.tsx (privacy notice)

**Purpose:** Static, unauthenticated privacy and cookie notice at `/privacy` covering the cookies the app sets, local-storage use, and account data handling.
**File:** `src/app/(public)/privacy/page.tsx`

### Renders
A single-column article: intro (instance-neutral, names the instance operator as the responsible party), a cookie table (name / purpose / lifetime for the three Auth.js cookies plus `ap_link` and `ap_setup`), a browser-storage section, an account-data section with rights contact, and a back-to-sign-in link.

### Behaviour & Interactions
- Pure static server component; no session read, reachable without auth.
- Copy states that all cookies are strictly necessary first-party cookies and that no consent banner is therefore shown; the cookie table must be kept in sync if any cookie is added or its TTL changes.

### Depends On
- `next/link`.
