## experimentalRouteExit.ts

**Purpose:** Pure helpers for experimental route exit anchors, staging picks, and well-known shortcut system ids.
**File:** `src/lib/map/experimentalRouteExit.ts`

### isKspaceSecurityLabel(security)
True for H/L/0.0/numeric/Pochven/Abyssal labels; false for wormhole `C<n>` classes.

### chainExitCandidates(systems) / pickPrimaryChainExit(systems, connections)
K-space systems on the map; primary exit prefers the highest on-map stargate degree among them.

### stagingTaggedSystems(systems)
Systems whose `tag` or `alias` matches `/staging/i`.

### topChainExitsForCompare(systems, connections, limit?)
Up to three exit anchors sorted by stargate degree for exit-route comparison UI.

### JITA_SYSTEM_ID / THERA_SYSTEM_ID / TURNUR_SYSTEM_ID
Exported constants for trade-hub and shattered-hub shortcuts.
