## MapShareIndicator

**Purpose:** The persistent "this map is published publicly" badge in the map header.
**File:** `src/components/map/MapShareIndicator.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| shares | LiveShareBadge[] | yes | Share links currently publishing this map |

### Renders
An amber pill with a broadcast icon reading "Public share live" (or "N public shares live"), whose tooltip names each live link's label. Renders nothing when no share is live.

### Behaviour & Interactions
- Rendered for **every** viewer of the map, not only those who can mint links — the people whose chain is on the wire are the ones who need to know.
- Re-evaluates each share's `expiresAt` on a 30s timer, so a timed link's badge clears itself without a reload.

### Depends On
- `LiveShareBadge` (`@/types`).

### Local State
- `now: number` — the clock the expiry sweep compares against.
