## ExperimentalPilotsPanel.tsx

**Purpose:** Chain-wide pilot roster grouped by map system (experimental Pilots panel).
**File:** `src/components/sidebar/ExperimentalPilotsPanel.tsx`

### Props

| Prop | Type | Description |
|---|---|---|
| viewData | MapViewData | Chain + presence |
| stats | Record<number, SystemStatsSummary> | optional 24h kill stats for hot-system badges |
| linkedMapSystemId | string \| null | Highlights a group (map hover or selection) |
| onHoverSystem | (id \| null) => void | Map highlight sync |
| onSelectSystem | (id) => void | Select system from the panel |

**Behaviour:** Groups pilots by on-map system with standing tint, role icons (main/alt, ship class), corp/ticker tooltip on `tag`, fade by `locationAt`, and two-way highlight with `MapCanvas` (`onPanelHoverSync` on `SystemNode`).
