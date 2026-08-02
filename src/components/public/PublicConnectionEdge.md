## PublicConnectionEdge

**Purpose:** xyflow custom edge rendering one connection on a public share, including the endpoint sig codes on hover.
**File:** `src/components/public/PublicConnectionEdge.tsx`

### Props
Receives xyflow `EdgeProps` with `data: PublicConnectionEdgeData`.

`PublicConnectionEdgeData` extends `PublicMapConnectionEdge` with `parallelIndex` and `parallelCount`, supplied by `SpectatorMap` so multiple holes between the same node pair fan out instead of stacking.

### Renders
A `BaseEdge` whose stroke comes from `connectionStyle` (scope picks the base colour, wormholes are recoloured by mass status, EOL stages dash progressively, frigate holes thin out). Gate links use an orthogonal path; everything else is a bezier. Midpoint labels render the `connectionBadges` row (`STATIC`, jump-mass size, EOL) plus standalone red rolling / preserve-mass flags with explanatory tooltips.

### Behaviour & Interactions
- Endpoints snap to whichever of the four node sides face each other, chosen from the dominant axis between the two node centres; parallel edges offset perpendicular to that axis.
- **Endpoint sig tags:** hovering a wormhole reveals a small tag at each end, nudged outward so it sits beside its own node — the two mouths of one hole carry different codes, and which to look for in which system is the point. An unscanned end renders an explicit dash with a tooltip saying so, never a blank tag. Hover is picked up by a transparent wide path over the edge.
- The tags exist only when `data.sigIds` is non-null, i.e. the token publishes endpoint codes. With the flag off the hover path is not rendered at all, so there is no affordance rather than an empty one.
- No selection styling, no travel animation, and no connection-detail popover — the app's version fetches a session-gated mass log.

### Depends On
- `@xyflow/react` (`BaseEdge`, `EdgeLabelRenderer`, `getBezierPath`, `getSmoothStepPath`, `useInternalNode`, `Position`)
- `@/components/map/styling` (`connectionStyle`, `connectionBadges`)
- `@base-ui/react/tooltip`, `lucide-react` (`RefreshCw`, `Shield`)
- Type `PublicMapConnectionEdge` from `@/types`

### Local State
- `hovered: boolean` — whether the pointer is over the edge, gating the sig tags.
