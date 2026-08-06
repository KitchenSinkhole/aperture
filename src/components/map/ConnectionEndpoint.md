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
A `<g className="nodrag nopan">` containing a transparent hit `<rect>` (rounded to a stadium) and, by state, the marks over it — all in `connectionEndpointColor()`, all centred at `anchor` nudged outward along `faceNormal(anchor.position)`, far enough that the node tile doesn't swallow the hit target's pointer events (further out than `ConnectionBubble`'s ring, which deliberately sits on the mouth):

- **idle** — nothing, and the hit target is `pointer-events: none`.
- **revealed** — a small faint dot, omitted when `bubbled` (the bubble's ring already marks that mouth).
- **armed** — a translucent halo filling the hit target's exact shape, ringed by a crisper stroke, with the dot at full opacity in its centre.

The hit target is `pointer-events: all` whenever live — needed because `.react-flow__edge` sets `pointer-events: visibleStroke`, which a fill-only shape wouldn't satisfy.

The hit target and halo are a face-oriented slot, not a plain circle: cross-face half-extent (the reach outward from the mouth, where the pointer arrives from) is always the full `HIT_RADIUS_PX * useMarkScale()`; along-face half-extent is that same radius clamped to `anchor.pitch / 2` — half the spacing to this end's nearest neighbour on the same node face, `0` when it's the sole occupant (unconstrained, so the slot degenerates to that same circle). Corner radius is `min(halfW, halfH)`, so an unconstrained slot renders as a circle and a squeezed one as a lozenge whose flat sides tile against its neighbours' with no gap and no overlap along the sweep.

### Behaviour & Interactions
- Hit radius, mark radii and standoff are all multiplied by `useMarkScale()`, so the target holds a clickable size on screen at any zoom; the along-face clamp is applied to the already-scaled radius but against the raw (unscaled) `anchor.pitch`, since the mark grows in flow space as the canvas zooms out while the fan's pitch does not. Must therefore be mounted inside a `ReactFlow` provider.
- The armed halo is drawn to exactly the hit target's shape, so what the pointer will act on is visible rather than inferred. Because the slot's along-face extent is capped at half the fan pitch, adjacent endpoints' targets are disjoint by construction — the armed mark is always the one nearest the pointer, not whichever overlapping circle happens to sit on top in DOM order.
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
