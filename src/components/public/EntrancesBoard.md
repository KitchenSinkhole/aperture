## EntrancesBoard

**Purpose:** The ways into the chain, read as a departures board — where to fly, what to scan when you get there, and where it comes out.
**File:** `src/components/public/EntrancesBoard.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| entrances | PublicMapEntrance[] | yes | Server-derived k-space entrances, already ordered nearest-hub-first. |
| onHover | (mapSystemId: string \| null) => void | yes | Fires with the hovered or focused row's `ap_map_system.id`, and null on leave. |

### Renders
A titled panel over the rail surface. Each row is three lines: the system name with its security label in the system-class colour (region name in the label's tooltip); a `Scan` line carrying the abbreviated sig code to probe there, with the far side's class and code pushed right; and the gate distance to the nearest trade hub. An empty list reads `No k-space entrance is on the map right now.`

A row whose hole leads toward Home carries a gold left rule and a gold home icon before the far side's class, so the direction reads both at a glance and on close reading. The colour and icon are the ones the canvas marks the Home tile with, so a guest learns one symbol.

For a guest with no map access this is the only part of the page that says what to do, so it leads rather than sitting behind a toggle.

### Behaviour & Interactions
- Rows are focusable, and hover or focus calls `onHover` so the matching canvas node highlights.
- An unscanned entrance shows an explicit dash rather than an empty slot; a system with no gate route to any hub says so instead of showing a blank distance.
- Rows rise into place on load with a per-row delay, capped after the first several so a long board does not crawl in. The animation is suppressed under reduced-motion.

### Depends On
- `@/components/map/styling` (`systemClassColor`, `homeAccentColor`)
- `@/lib/eve/drifterSystems` (`systemDisplayName`)
- Type `PublicMapEntrance` from `@/types`
