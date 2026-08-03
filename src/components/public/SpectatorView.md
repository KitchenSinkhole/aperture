## SpectatorView

**Purpose:** The spectator shell for a public share link — promo bar, entrances board, chain canvas, and status strip.
**File:** `src/components/public/SpectatorView.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| token | string | yes | The share token, passed to `usePublicSnapshot` to open the public socket and refetch. |
| initialData | PublicMapViewData | yes | The server-rendered redacted snapshot `usePublicSnapshot` seeds its state with. |

### Renders
A full-height column: `PromoBar`, then a split body, then a status-strip footer. Below `lg` the split stacks with the entrances board beneath the map, capped at two fifths of the split's height so the chain keeps the other three; at `lg` and up the board becomes a fixed-width left rail. The footer leads with a feed indicator (a dot plus `LIVE`/`DELAYED`/`ENDED` and "updated Ns ago"), then counts systems, connections, and (when the token publishes a roster) pilots, with a `Read-only public view` marker pinned right.

An empty map renders `Nothing is mapped here yet.` in place of the canvas; once the feed ends, the canvas region instead renders a short "this share link has ended" panel and the `IntroCard` is hidden. The board, bar and footer stay in both cases.

### Behaviour & Interactions
- Owns the route highlight. Hovering, focusing or tapping an entrances-board row lights that entrance's whole way into the chain: the k-space system it starts in, every hop connection along the way to Home, and each system those hops pass through, with the sig code at both mouths of every lit hole. An entrance with no way home lights only its own hole. Hover takes precedence over a pin, so pointing at a second row previews it without discarding the pinned one.
- A tap pins a route (touch has no hover, and this link is built to be pasted into Discord); tapping the same row again, or clicking the canvas off the chain, clears it.
- Rows are tracked by connection id rather than held as objects, so a refetch that drops or rewrites an entrance clears the highlight instead of lighting a stale route.
- `IntroCard` floats over the canvas's bottom-left corner in a `pointer-events-none` wrapper so it never blocks a pan or the bottom-right canvas controls.
- Renders off `usePublicSnapshot`'s `data`, not the `initialData` prop directly, so a live nudge/refetch updates the whole page. Nothing here mutates anything.

### Depends On
- `PromoBar`, `EntrancesBoard`, `SpectatorMap`, `IntroCard`
- `usePublicSnapshot` (`./usePublicSnapshot`) — data, feed status, and last-update time
- Type `PublicMapViewData` from `@/types`

### Local State
- `hoveredEntranceId: string | null` — `connectionId` of the entrance row under the cursor or keyboard focus.
- `pinnedEntranceId: string | null` — `connectionId` of the entrance row whose route is pinned.
- `now` (in the internal `useElapsedSeconds` helper) — ticks once a second to keep the footer's "updated Ns ago" current.
