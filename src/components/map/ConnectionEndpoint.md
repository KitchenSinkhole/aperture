## ConnectionEndpoint

**Purpose:** The interactable hit target at one mouth of a connection — app canvas only, invisible until hovered, right-click opens the endpoint context menu.
**File:** `src/components/map/ConnectionEndpoint.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| end | ConnectionEnd | yes | Which mouth this instance represents. |
| anchor | EdgeAnchor | yes | This end's attachment point and face. |
| visible | boolean | yes | Whether the small dot renders (the hit circle is always present). |
| color | string | yes | Dot fill colour. |
| onContextMenu | (end: ConnectionEnd, clientX: number, clientY: number) => void | yes | Fired on right-click, after `preventDefault`/`stopPropagation`. |

### Renders
A `<g className="nodrag nopan">` containing a transparent hit `<circle>` (r 11, `pointer-events: all` — needed because `.react-flow__edge` sets `pointer-events: visibleStroke`, which a fill-only circle wouldn't satisfy) and, when `visible`, a small faint dot (r 3, `fillOpacity 0.7`). Both are centred at `anchor` nudged outward along `faceNormal(anchor.position)` by the same 10px standoff `ConnectionBubble` uses, so the dot and a set bubble land on the same spot.

### Behaviour & Interactions
- `onContextMenu` stops propagation so xyflow's edge-level `onEdgeContextMenu` doesn't also fire — right-clicking the dot opens only the endpoint menu, not the connection menu.
- A plain left click is left to bubble untouched, so the edge's own click-to-select handler still fires.
- Kept as its own component, separate from `ConnectionBubble`'s purely visual marker, so issue #124 (drag-to-override face placement) can add drag handlers here without touching the bubble.

### Depends On
- `@/lib/map/edgeAnchors` (`faceNormal`).
- `./useEdgeAnchors` (`EdgeAnchor` type).
- `@/types` (`ConnectionEnd`).
