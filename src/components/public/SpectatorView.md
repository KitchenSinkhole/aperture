## SpectatorView

**Purpose:** The spectator shell for a public share link — promo bar, entrances board, chain canvas, and status strip.
**File:** `src/components/public/SpectatorView.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| token | string | yes | The share token, passed to `usePublicSnapshot` to open the public socket and refetch. |
| initialData | PublicMapViewData | yes | The server-rendered redacted snapshot `usePublicSnapshot` seeds its state with. |

### Renders
A full-height column: `PromoBar`, then a split body, then a status-strip footer. Below `lg` the split stacks with the entrances board beneath the map, capped to a fraction of the viewport so the chain keeps most of a phone screen; at `lg` and up the board becomes a fixed-width left rail. The footer leads with a feed indicator (a dot plus `LIVE`/`DELAYED`/`ENDED` and "updated Ns ago"), then counts systems, connections, and (when the token publishes a roster) pilots, with a `Read-only public view` marker pinned right.

An empty map renders `Nothing is mapped here yet.` in place of the canvas; once the feed ends, the canvas region instead renders a short "this share link has ended" panel and the `IntroCard` is hidden. The board, bar and footer stay in both cases.

### Behaviour & Interactions
- Owns `highlightedSystemId`: hovering or focusing an entrances-board row rings the matching node on the canvas.
- `IntroCard` floats over the canvas's bottom-right corner in a `pointer-events-none` wrapper so it never blocks a pan.
- Renders off `usePublicSnapshot`'s `data`, not the `initialData` prop directly, so a live nudge/refetch updates the whole page. Nothing here mutates anything.

### Depends On
- `PromoBar`, `EntrancesBoard`, `SpectatorMap`, `IntroCard`
- `usePublicSnapshot` (`./usePublicSnapshot`) — data, feed status, and last-update time
- Type `PublicMapViewData` from `@/types`

### Local State
- `highlightedSystemId: string | null` — `ap_map_system.id` of the entrance row under the cursor.
- `now` (in the internal `useElapsedSeconds` helper) — ticks once a second to keep the footer's "updated Ns ago" current.
