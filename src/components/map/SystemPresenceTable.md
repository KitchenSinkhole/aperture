## SystemPresenceTable

**Purpose:** Dense, header-less Pilot / Type / Ship table for the `SystemNode` presence-badge hover popup — the per-system pilot list, decoupled from `PilotRosterTable`.
**File:** `src/components/map/SystemPresenceTable.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| presence | readonly MapPresenceEntry[] | yes | The pilots in one system. Sorted by character name; rendered as-is (no re-filtering). |

### Renders
A bare `w-full text-xs` `<table>` with no `<thead>` — one row per pilot with three cells: character name, ship hull type (`shipTypeName`, or `—`), and the pilot's custom hull name (`customShipName`, or `—`). Cells are densely padded (`px-2 py-0.5`); the Type and Ship cells clip to a responsive max width (`max-w-[100px] lg:max-w-[180px]`) with an ellipsis and a `title` tooltip carrying the full value. No scroll wrapper — the popover sizes itself.

### Behaviour & Interactions
- Sorted by character name ascending (defensive — presence already arrives name-sorted).
- No empty state: the only caller (`PresenceBadge`) renders it only when there is at least one pilot.

### Depends On
- `customShipName` from `@/components/map/PilotRosterTable` — the pilot's custom hull name, or `''` when un-renamed.
- Type `MapPresenceEntry` from `@/types`.
