## ConnectionBubble

**Purpose:** Visual marker for one bubbled end of a connection — a ring straddling the line at the mouth plus a gradient wash fading out along the line.
**File:** `src/components/map/ConnectionBubble.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| gradientId | string | yes | Unique per edge + end; used as the SVG `<linearGradient>` id and referenced via `url(#…)`. |
| path | string | yes | The edge's own `d` (from `getBezierPath`/`getSmoothStepPath`), so the wash tracks its curvature exactly. |
| strokeWidth | number | yes | The connection's rendered stroke width; the wash overlay is drawn a few zoom-compensated pixels wider on each side. |
| anchor | EdgeAnchor | yes | This end's attachment point and face — where the ring sits and the wash originates. |
| far | EdgeAnchor | yes | The connection's other end — the wash fades toward it. |

### Renders
One `pointer-events: none` `<g>`: a `<linearGradient gradientUnits="userSpaceOnUse" spreadMethod="pad">` running from `anchor` toward `far`, in `connectionBubbleColor()` — near-full opacity at the mouth, held through the first stretch before falling away to fully transparent at the wash's end, since a straight ramp to zero spends most of its length too faint to register. An overlay `<path>` reusing `path`, stroked with that gradient — no `strokeDasharray`, so a solid wash reads correctly even under a dashed EOL line. Plus a stroked, faintly filled `<circle>` centred on `anchor` nudged a few px outward along `faceNormal(anchor.position)`.

Wash length is a fraction of the connection's straight-line length, floored so two adjacent systems still get a readable run of gradient and capped so a long connection doesn't smear it too far. The floor yields to half the connection rather than overriding it, so a wash never reaches the far end and a single flagged end never reads as staining the whole line.

### Behaviour & Interactions
- Consumers render it **before** `<BaseEdge>`, so the connection stroke paints over the ring's midline: the line visibly enters and leaves the ring, which is what a bubble is — a volume crossed on the jump, not a property hanging off the line. An open ring also holds its contrast at small sizes far better than a translucent disc.
- The ring sits on the mouth itself and lets the node tile (which the edges layer paints under) clip its inner arc. A standoff large enough to clear the tile detaches the ring from the mouth wherever the bezier turns sharply, because the standoff follows the face normal while the line leaves at its own angle.
- Every dimension (ring radius, ring stroke, standoff, wash spread) is multiplied by `useMarkScale()`, so the mark holds its design size on screen as the canvas zooms. Wash *length* is not compensated — it stays proportional to the connection's own geometry.
- No state and no `data` prop; shared by the app canvas (`ConnectionEdge`) and the spectator canvas (`PublicConnectionEdge`). The `useMarkScale` subscription means it must be mounted inside a `ReactFlow` provider.
- `dist === 0` (coincident anchors) is guarded so the wash direction is never `NaN`.

### Depends On
- `@/lib/map/edgeAnchors` (`faceNormal`) — outward standoff direction.
- `./useEdgeAnchors` (`EdgeAnchor` type).
- `./styling` (`connectionBubbleColor`).
- `./useMarkScale` — zoom compensation.
