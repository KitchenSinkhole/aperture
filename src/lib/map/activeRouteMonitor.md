## activeRouteMonitor.ts

**Purpose:** Pure helpers for experimental active-route client alerts (on-route checks, hop connection ids, off-route followers).
**File:** `src/lib/map/activeRouteMonitor.ts`

### activeRouteHopSystemIds(hops)
Returns the set of EVE system ids on the plan.

### isOnActiveRoute(hops, systemId)
Whether a system id appears on the hop list.

### activeRouteProgressIndex(hops, waypointCursor, currentSystemId)
First remaining hop index — respects stored cursor and advances to the pilot's system when on-path.

### remainingActiveRouteHops(hops, waypointCursor, currentSystemId)
Hops from `activeRouteProgressIndex` through destination (full remaining leg).

### activeRouteConnectionIds(hops)
Distinct map connection ids (strings) for wormhole hops.

### followersOffRoute(hops, presence, followerCharacterIds)
Lists followers whose current presence system is not on the hop list.

### routeConnectionsById(hops, connections)
Map of connection id → edge for hops that reference a map wormhole.
