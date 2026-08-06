## ConnectionEndpoint

**Purpose:** The interactable hit target at one mouth of a connection — app canvas only, invisible until hovered, right-click opens the endpoint context menu.
**File:** `src/components/map/ConnectionEndpoint.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| end | ConnectionEnd | yes | Which mouth this instance represents. |
| anchor | EdgeAnchor | yes | This end's attachment point and face. |
| visible | boolean | yes | Whether the small dot renders (the hit circle is always present). |
| onContextMenu | (end: ConnectionEnd, clientX: number, clientY: number) => void | yes | Fired on right-click, after `preventDefault`/`stopPropagation`. |

### Renders
A `<g className="nodrag nopan">` containing a transparent hit `<circle>` (`pointer-events: all` — needed because `.react-flow__edge` sets `pointer-events: visibleStroke`, which a fill-only circle wouldn't satisfy) and, when `visible`, a small faint dot in `connectionEndpointColor()`. Both are centred at `anchor` nudged outward along `faceNormal(anchor.position)`, far enough that the node tile doesn't swallow the hit circle's pointer events — further out than `ConnectionBubble`'s ring, which deliberately sits on the mouth.

### Behaviour & Interactions
- Hit radius, dot radius and standoff are all multiplied by `useMarkScale()`, so the target holds a clickable size on screen at any zoom. Must therefore be mounted inside a `ReactFlow` provider.
- The dot is a neutral grey rather than the bubble hue: it marks where a control is, not what state the end is in, and the two must not be confused when a bubbled end is hovered.
- `onContextMenu` stops propagation so xyflow's edge-level `onEdgeContextMenu` doesn't also fire — right-clicking the dot opens only the endpoint menu, not the connection menu.
- A plain left click is left to bubble untouched, so the edge's own click-to-select handler still fires.
- Kept as its own component, separate from `ConnectionBubble`'s purely visual marker, so issue #124 (drag-to-override face placement) can add drag handlers here without touching the bubble.

### Depends On
- `@/lib/map/edgeAnchors` (`faceNormal`).
- `./useEdgeAnchors` (`EdgeAnchor` type).
- `./styling` (`connectionEndpointColor`).
- `./useMarkScale` — zoom compensation.
- `@/types` (`ConnectionEnd`).
