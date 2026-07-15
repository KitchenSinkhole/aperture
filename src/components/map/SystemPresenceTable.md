## SystemPresenceTable

**Purpose:** Dense, header-less Pilot / Icon / Type / Ship table for the `SystemNode` presence-badge hover popup — the per-system pilot list, decoupled from `PilotRosterTable`.
**File:** `src/components/map/SystemPresenceTable.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| presence | readonly MapPresenceEntry[] | yes | The pilots in one system. Sorted by character name; rendered as-is (no re-filtering). |

### Renders
A bare `w-full text-xs` `<table>` with no `<thead>` — one row per pilot with four cells: character name, a `ShipClassIcon` column (`p.shipClass`), ship hull type (`shipTypeName`, or `—`), and the pilot's custom hull name (`customShipName`, or `—`). Cells are densely padded; the icon cell overrides this to hug the icon with no padding and a width pinned to its intrinsic size, so it doesn't get stretched by the table's auto layout. The Type and Ship cells clip to a responsive max width with an ellipsis and a `title` tooltip carrying the full value. No scroll wrapper — the popover sizes itself.

### Behaviour & Interactions
- Sorted by character name ascending (defensive — presence already arrives name-sorted).
- No empty state: the only caller (`PresenceBadge`) renders it only when there is at least one pilot.

### Depends On
- `customShipName` from `@/components/map/PilotRosterTable` — the pilot's custom hull name, or `''` when un-renamed.
- `ShipClassIcon` from `@/components/icons/ShipClassIcon`
- Type `MapPresenceEntry` from `@/types`.
