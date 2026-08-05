## ConnectionBubble

**Purpose:** Pure visual marker for one bubbled end of a connection — a small circle at the mouth plus a gradient wash fading out along the line.
**File:** `src/components/map/ConnectionBubble.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| gradientId | string | yes | Unique per edge + end; used as the SVG `<linearGradient>` id and referenced via `url(#…)`. |
| path | string | yes | The edge's own `d` (from `getBezierPath`/`getSmoothStepPath`), so the wash tracks its curvature exactly. |
| strokeWidth | number | yes | The connection's rendered stroke width; the wash overlay is drawn 8px wider. |
| anchor | EdgeAnchor | yes | This end's attachment point and face — where the bubble sits and the wash originates. |
| far | EdgeAnchor | yes | The connection's other end — the wash fades toward it. |

### Renders
One `pointer-events: none` `<g>`: a `<linearGradient gradientUnits="userSpaceOnUse" spreadMethod="pad">` running from `anchor` toward `far` for `min(dist * 0.2, 120px)`, stops fading from 50% to 0% opacity of `connectionBubbleColor()`; an overlay `<path>` reusing `path`, stroked with that gradient, `strokeWidth + 8` — no `strokeDasharray`, so a solid wash reads correctly even under a dashed EOL line. Plus a `<circle>` (r 6) at `anchor` nudged outward along `faceNormal(anchor.position)` by 10px, so it clears the node tile the edges layer paints under.

### Behaviour & Interactions
- No hooks, no state, no `data` prop — a pure function of its props, shared verbatim by the app canvas (`ConnectionEdge`) and the spectator canvas (`PublicConnectionEdge`).
- `dist === 0` (coincident anchors) is guarded so the wash direction is never `NaN`.

### Depends On
- `@/lib/map/edgeAnchors` (`faceNormal`) — outward standoff direction.
- `./useEdgeAnchors` (`EdgeAnchor` type).
- `./styling` (`connectionBubbleColor`).
