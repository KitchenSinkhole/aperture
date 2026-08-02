## SpectatorView

**Purpose:** The spectator shell for a public share link — promo bar, entrances board, chain canvas, and status strip.
**File:** `src/components/public/SpectatorView.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| data | PublicMapViewData | yes | The redacted snapshot. The only source of anything the page renders. |

### Renders
A full-height column: `PromoBar`, then a split body, then a status-strip footer. Below `lg` the split stacks with the entrances board beneath the map, capped to a fraction of the viewport so the chain keeps most of a phone screen; at `lg` and up the board becomes a fixed-width left rail. The footer counts systems, connections, and (when the token publishes a roster) pilots, with a `Read-only public view` marker pinned right.

An empty map renders `Nothing is mapped here yet.` in place of the canvas; the board, bar and footer stay.

### Behaviour & Interactions
- Owns `highlightedSystemId`: hovering or focusing an entrances-board row rings the matching node on the canvas.
- `IntroCard` floats over the canvas's bottom-right corner in a `pointer-events-none` wrapper so it never blocks a pan.
- Nothing here mutates anything, and nothing subscribes to realtime.

### Depends On
- `PromoBar`, `EntrancesBoard`, `SpectatorMap`, `IntroCard`
- Type `PublicMapViewData` from `@/types`

### Local State
- `highlightedSystemId: string | null` — `ap_map_system.id` of the entrance row under the cursor.
