## MapNoteNode

**Purpose:** xyflow node rendering a free-standing map note — a severity-coloured card with a short title and an optional longer body.
**File:** `src/components/map/MapNoteNode.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| data | MapNoteNodeData | yes | The note row (`MapNote`) plus an optional `onOpen(id)` wired by `MapCanvas`. |
| selected | boolean | yes | xyflow selection flag — drives the halo/outline. |

`MapNoteNodeData = MapNote & { onOpen?: (id: string) => void }`. `onOpen` is absent on a read-only path (mirrors `SystemNode`'s optional `onAliasOrTagCommit`).

### Renders
A `bg-map-node` card with a severity-coloured left border + ring (`noteSeverityColor(data.severity)` from `styling.ts`), the `title` as a truncated label, a `Lock` glyph when `data.locked`, and a 2-line clamped `content` preview rendered as markdown via `NoteContent` (GFM + `[color]…[/color]` tags). When `content` is set the whole card is a `Tooltip.Trigger` whose popup shows the full rendered markdown body; with no body it renders the bare card.

### Behaviour & Interactions
- Double-click → `data.onOpen?.(data.id)` (selects the note → opens the inspector). `stopPropagation` prevents xyflow's pane double-click zoom from also firing.
- No `<Handle>` elements — notes don't connect to anything.
- Selection treatment (resting ring + brighter halo + slight scale) copies `SystemNode`'s `boxShadow`/`outline` idiom.

### Depends On
- `noteSeverityColor` (`./styling`)
- `NoteContent` (`./NoteContent`) — markdown + colour-tag rendering for the snippet and tooltip
- `MapNote` type (`@/lib/map/loadMap`)
- Base UI `Tooltip`, lucide `Lock`
