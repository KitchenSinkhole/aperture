## PublicMapPage

**Purpose:** The spectator view at `/live/[token]` — a read-only render of a shared map for a viewer with no session.
**File:** `src/app/(public)/live/[token]/page.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| params | Promise<{ token: string }> | yes | Share token from the URL |

### Renders
`SpectatorView`, handed the redacted snapshot. The page itself derives nothing — it resolves the token, 404s or renders.

### Behaviour & Interactions
- A token that does not resolve (unknown, expired, revoked, soft-deleted parent map) calls `notFound()`, so all four cases render the same 404 without distinguishing which.
- `generateMetadata` marks the page `noindex, nofollow` — a share link is unguessable and revocable, and indexing would outlive both. Open Graph and Twitter card metadata are still emitted: chat and forum unfurlers ignore robots, so a pasted link renders a card. Its `getPublicSnapshot` call shares the cache entry with the render, so the page costs one load.
- A server component; the interactive shell below it is the client boundary. No session read, no realtime subscription.

### Depends On
- `getPublicSnapshot` (`src/lib/map/publicSnapshot.ts`) — the cached, redacted projection.
- `SpectatorView` (`src/components/public/SpectatorView.tsx`).
