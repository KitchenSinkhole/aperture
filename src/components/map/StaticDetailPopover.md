## StaticDetailPopover

**Purpose:** Hover popover anchored to a system node's static label, surfacing that static wormhole's routing data (code, size, leads-to class, masses, lifetime).
**File:** `src/components/map/StaticDetailPopover.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| typeId | number | yes | The static's source `universe_wormhole.type_id` — keys the reference lookup. |
| children | ReactNode | yes | The styled static label rendered inside the tooltip trigger. |

### Renders
A base-ui `Tooltip` whose trigger wraps `children` (the footer's class label) and whose popup renders `WormholeReferenceRows` — header (code / size / leads-to class) plus Total mass / Max jump / Max lifetime. No mass-logged or EOL rows: a static is an unrealised connection.

### Behaviour & Interactions
- Opens on hover. On open, fetches the session-cached wormhole reference (`fetchWormholeJumpInfo`) and picks the row matching `typeId`; skips the fetch once the held row already matches. Rows read `unknown` / empty until the fetch resolves.
- Size band is derived client-side from the reference `jumpMass` via `jumpMassBand`.
- Trigger and popup carry `nodrag nopan` so hovering a static never starts a canvas pan/drag.

### Depends On
- `@base-ui/react/tooltip` (`Tooltip`).
- `@/lib/reference/client` (`fetchWormholeJumpInfo`).
- `@/lib/map/wormholeCatalog` (`jumpMassBand`).
- `./WormholeDetailRows` (`WormholeReferenceRows`).
