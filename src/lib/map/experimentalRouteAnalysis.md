## experimentalRouteAnalysis.ts

**Purpose:** Pure client summaries for experimental route analysis UI (kills, WH mass/EOL, pilots on path).
**File:** `src/lib/map/experimentalRouteAnalysis.ts`

### summarizeRoutePlan({ plan, connections, stats, presence, intel })
Returns labelled lines: jump count, aggregated 24h kills on traversed systems, incursion count when intel rows exist, wormhole mass/EOL notes keyed by hop name, and pilot names from presence.

### connectionMetaForHop(hop, connections)
Resolves `RouteHop.connectionId` to a live `MapConnectionEdge` when present.
