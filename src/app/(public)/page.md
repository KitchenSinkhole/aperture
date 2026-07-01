## page.tsx (public landing)

**Purpose:** Public splash at `/` — product blurb and the EVE SSO login button; redirects authenticated users to `/maps`.
**File:** `src/app/(public)/page.tsx`

### Renders
A centered hero (logo image, title + blurb) with the `LoginButton`. Logo is served from `/public/aperture logo.png`.

### Behaviour & Interactions
- Server component: `getSession()`; if a character is active, `redirect('/maps')`.

### Depends On
- `getSession` (`src/lib/session.ts`), `LoginButton`.
