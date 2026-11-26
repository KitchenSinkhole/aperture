## routeShortcuts.ts

**Purpose:** Server-only resolvers for experimental one-click route destinations over the static gate graph.
**File:** `src/lib/map/routeShortcuts.ts`

### resolveRouteShortcut(kind, sourceSystemId)
`nearest_highsec` — BFS on the cached stargate adjacency until the first system with `true_sec >= 0.45` (excluding the source). Returns the EVE solar-system id or null when unreachable.
