## EntrancesBoard

**Purpose:** The ways into the chain, read as a departures board — where to fly, what to scan when you get there, and where it comes out.
**File:** `src/components/public/EntrancesBoard.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| entrances | PublicMapEntrance[] | yes | Server-derived k-space entrances, already ordered nearest-hub-first. |
| pinnedEntranceId | string \| null | yes | `connectionId` of the row whose route is pinned; that row renders pressed. |
| onHover | (connectionId: string \| null) => void | yes | Fires with the hovered or focused row's `connectionId`, and null on leave. |
| onPin | (connectionId: string) => void | yes | Fires with the tapped row's `connectionId`; the owner toggles the pin. |

### Renders
A titled panel over the rail surface. Entrances that lead to the map's Home are grouped under a "Ways to home" heading; every other entrance sits under "Other entrances" below it. Either heading is omitted when its group is empty, and the list renders flat (ungrouped) when nothing leads home at all.

Every row opens with the system name and its security label in the system-class colour (region name in the label's tooltip), then the gate distance to the nearest trade hub. A home row continues with a turn-by-turn hop list: each line is the sig code to scan standing in that system, an arrow, the arrival system's class label and operator-assigned tag (when it has one) both in the class colour, and the arrival system's name — the tag rides alongside the class rather than replacing it, since a tag is how a guest actually matches the hop to a tile on the canvas. The final hop into Home additionally carries the gold home icon after the name. A non-home row instead gets a single `Scan` line carrying the abbreviated sig code, with the far side's class pushed right. An empty board reads `No k-space entrance is on the map right now.`

A home row carries a gold left rule, reinforcing the grouping. The colour and icon are the ones the canvas marks the Home tile with, so a guest learns one symbol.

For a guest with no map access this is the only part of the page that says what to do, so it leads rather than sitting behind a toggle.

### Behaviour & Interactions
- Each row is a full-width button carrying the whole row's content, so it is reachable by keyboard and tappable on a phone, which has no hover to give.
- Hover or focus calls `onHover`, lighting that entrance's route on the canvas; a click calls `onPin`, and the pinned row renders pressed (`aria-pressed`, with a held background) so a route can be read without holding the pointer still.
- An unscanned hop shows an explicit dash rather than an empty slot; a system with no gate route to any hub says so instead of showing a blank distance.
- A home route past four hops collapses its middle jumps into one `⋯ N more jumps` line, always keeping the first two hops and the final hop into Home visible.
- When every hop on a home route is unscanned (the token withholds codes, or nobody has scanned any of it), the sig column drops entirely and the row reads as a plain system-name path rather than a set of things to scan.
- Rows rise into place on load with a per-row delay, running continuously across both groups and capped after the first several so a long board does not crawl in. The animation is suppressed under reduced-motion.

### Depends On
- `@/components/map/styling` (`systemClassColor`, `homeAccentColor`)
- `@/lib/eve/drifterSystems` (`systemDisplayName`)
- Types `PublicMapEntrance`, `PublicMapEntranceHop` from `@/types`
