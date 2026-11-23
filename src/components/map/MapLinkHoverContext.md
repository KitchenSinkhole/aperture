## MapLinkHoverContext

**Purpose:** Shares which connection edge is hovered so the canvas can dim non-participants and highlight both endpoint systems (experimental link salience).
**File:** `src/components/map/MapLinkHoverContext.tsx`

### MapLinkHoverProvider
Wraps the map canvas subtree when experimental link hover chrome is active.

### useMapLinkHover / useSetMapLinkHover
Read and write `{ edgeId, sourceId, targetId }`.

### useIsLinkHoverDimActive
True while any connection edge is hovered.

### useIsLinkEndpointLit(mapSystemId)
True when the given `ap_map_system.id` is an endpoint of the hovered connection.
