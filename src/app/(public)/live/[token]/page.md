## PublicMapPage

**Purpose:** The spectator view at `/live/[token]` — a read-only render of a shared map for a viewer with no session.
**File:** `src/app/(public)/live/[token]/page.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| params | Promise<{ token: string }> | yes | Share token from the URL |

### Renders
A header carrying the map name, the share's label and a read-only marker, above a server-rendered SVG of the chain: one rounded rect per visible system (name, tag, security class, accent tinted by `systemSecurityColor`) and a straight line per connection between node centres. Node geometry uses `NODE_WIDTH` / `NODE_HEIGHT` from `placement.ts`, and the `viewBox` is fitted to the systems' bounds so the whole chain is visible without interaction. A map with no visible systems renders a short empty state.

Pilot presence appears only as a count badge on a node, derived from whichever presence projection the token publishes; `none` yields no badges.

### Behaviour & Interactions
- A token that does not resolve (unknown, expired, revoked, soft-deleted parent map) calls `notFound()`, so all four cases render the same 404 without distinguishing which.
- `generateMetadata` marks the page `noindex, nofollow` — a share link is unguessable and revocable, and indexing would outlive both. Its `getPublicSnapshot` call shares the cache entry with the render, so the page costs one load.
- Entirely server-rendered: no client component, no session read, no realtime subscription.

### Depends On
- `getPublicSnapshot` (`src/lib/map/publicSnapshot.ts`) — the cached, redacted projection.
- `systemSecurityColor` (`src/components/map/styling.ts`), `NODE_WIDTH` / `NODE_HEIGHT` (`src/lib/map/placement.ts`).
