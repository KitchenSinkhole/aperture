## ShipClassIcon

**Purpose:** 16px hull-class icon rendered next to a pilot's ship type name.
**File:** `src/components/icons/ShipClassIcon.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| shipClass | ShipClass \| null | yes | Broad hull-class bucket to render; null shows the placeholder |
| className | string | no | Extra classes merged onto the rendered element |

### Renders
A `<img>` at `/ship-icons/{shipClass}.png` with `alt`/`title` set to the human-readable
`SHIP_CLASS_LABELS[shipClass]` (`src/lib/eve/shipClass.ts`). When `shipClass` is null, renders a
`bg-muted` placeholder square of the same size instead.

### Used By
- `PilotRosterTable` — the Type column, next to `shipTypeName`.
- `SystemPresenceTable` — the Type column, next to `shipTypeName`.
- `SystemOverlay` (`Pilots`) — the Type column, next to `shipTypeName`.
