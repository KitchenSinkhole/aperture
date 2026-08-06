## ConnectionEndpoint

**Purpose:** The interactable hit target at one mouth of a connection — app canvas only, inert until the edge is hovered, right-click opens the endpoint context menu.
**File:** `src/components/map/ConnectionEndpoint.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| end | ConnectionEnd | yes | Which mouth this instance represents. |
| anchor | EdgeAnchor | yes | This end's attachment point and face. |
| state | `'idle' \| 'revealed' \| 'armed'` | yes | Inert, marked-but-not-under-the-pointer, or under the pointer. |
| bubbled | boolean | yes | Whether this end carries a bubble; suppresses the revealed dot. |
| onHoverChange | (end: ConnectionEnd, hovered: boolean) => void | yes | Fired on pointer enter/leave of the hit circle. |
| onContextMenu | (end: ConnectionEnd, clientX: number, clientY: number) => void | yes | Fired on right-click, after `preventDefault`/`stopPropagation`. |

### Renders
A `<g className="nodrag nopan">` containing a transparent hit `<circle>` and, by state, the marks over it — all in `connectionEndpointColor()`, all centred at `anchor` nudged outward along `faceNormal(anchor.position)`, far enough that the node tile doesn't swallow the hit circle's pointer events (further out than `ConnectionBubble`'s ring, which deliberately sits on the mouth):

- **idle** — nothing, and the hit circle is `pointer-events: none`.
- **revealed** — a small faint dot, omitted when `bubbled` (the bubble's ring already marks that mouth).
- **armed** — a translucent halo filling the hit radius exactly, ringed by a crisper stroke, with the dot at full opacity in its centre.

The hit circle is `pointer-events: all` whenever live — needed because `.react-flow__edge` sets `pointer-events: visibleStroke`, which a fill-only circle wouldn't satisfy.

### Behaviour & Interactions
- Hit radius, mark radii and standoff are all multiplied by `useMarkScale()`, so the target holds a clickable size on screen at any zoom. Must therefore be mounted inside a `ReactFlow` provider.
- The armed halo is drawn at exactly the hit radius, so what the pointer will act on is visible rather than inferred. A fanned node face packs neighbouring endpoints closer together than one hit circle is wide, and overlapping circles resolve by edge z-order, so seeing the armed boundary is the only reliable way to tell which end a right-click lands on.
- An idle endpoint takes no pointer events at all, so a right-click near a node face can't open an endpoint menu for a mark that isn't showing.
- The marks are a neutral grey rather than the bubble hue: they mark where a control is, not what state the end is in, and the two must not be confused when a bubbled end is hovered.
- `onContextMenu` stops propagation so xyflow's edge-level `onEdgeContextMenu` doesn't also fire — right-clicking an endpoint opens only the endpoint menu, not the connection menu.
- A plain left click is left to bubble untouched, so the edge's own click-to-select handler still fires.
- Kept as its own component, separate from `ConnectionBubble`'s purely visual marker, so issue #124 (drag-to-override face placement) can add drag handlers here without touching the bubble.

### Depends On
- `@/lib/map/edgeAnchors` (`faceNormal`).
- `./useEdgeAnchors` (`EdgeAnchor` type).
- `./styling` (`connectionEndpointColor`).
- `./useMarkScale` — zoom compensation.
- `@/types` (`ConnectionEnd`).
