## PublicConnectionEdge

**Purpose:** xyflow custom edge rendering one connection on a public share, including the endpoint sig codes on hover.
**File:** `src/components/public/PublicConnectionEdge.tsx`

### Props
Receives xyflow `EdgeProps` with `data: PublicConnectionEdgeData` (`PublicMapConnectionEdge` plus `endpointSecurity: { source, target }` — each end's `universe_system.security` label, for tinting the sig tags; `highlighted: boolean`, set while this hole is on the lit route; and `onHoverChange: (connectionId: string | null) => void`, which this edge calls on hover/unhover so `SpectatorMap` can ring both endpoint tiles).

### Renders
A `BaseEdge` whose stroke comes from `connectionStyle` (scope picks the base colour, wormholes are recoloured by mass status, EOL stages dash progressively, frigate holes thin out). Gate links use an orthogonal path; everything else is a bezier. Each end flagged bubbled draws a `ConnectionBubble` under the stroke. Midpoint labels render the `connectionBadges` row (`STATIC`, jump-mass size, EOL) plus standalone red rolling / preserve-mass flags with explanatory tooltips.

### Behaviour & Interactions
- Endpoint sides come from `useEdgeAnchors(id, source, target)`: dominant-axis face selection, then this edge's rank among the other edges sharing that face (by departure angle) picks its own attachment point, fanning multiple connections off one face instead of converging them on a point. Parallel holes between one node pair need no special case — they share a departure angle and separate only by the rank tie-break. Falls back to the `sourceX/Y/Position` / `targetX/Y/Position` props while a node is unmeasured.
- A `highlighted` connection thickens its stroke and gains a glow in its own stroke colour, and shows both sig tags with no pointer on it, so a whole route reads as one thread.
- **Endpoint sig tags:** hovering a wormhole (or lighting its route) reveals a small tag at each end, placed flush against that connection's own fanned attachment point on its endpoint's face and lapping a few px onto the tile, so it reads as a tab clipped to the node it belongs to rather than a label floating in the gap. The two mouths of one hole carry different codes, and which to look for in which system is the point. When the gap between the two tiles is too short for both tags to clear each other head-on, they shift apart perpendicular to the face instead — each tag still touches its own node, so this never trades away attribution. The border is tinted with the *far* system's class colour via `systemClassColor`, a second cue independent of position. An unscanned end renders an explicit dash, never a blank tag. Hover is picked up by a transparent wide path over the edge. Both the sig tags and the badge/flag label stack are given an explicit high `z-index` so they paint above node tiles — `EdgeLabelRenderer` content otherwise sits below `NodeRenderer` in xyflow's DOM order and would be clipped by whichever node it laps onto.
- The tags exist only when `data.sigIds` is non-null, i.e. the token publishes endpoint codes. With the flag off the hover path is not rendered at all, so there is no affordance rather than an empty one.
- Hover also calls `data.onHoverChange` with this edge's id (or `null` on leave), which `SpectatorMap` uses to ring both endpoint tiles for the duration.
- **Bubbled ends:** `data.sourceBubbled` / `data.targetBubbled` each render the same `ConnectionBubble` the app canvas draws, sharing the edge's effective stroke width so the wash straddles the line identically. Gradient ids are namespaced apart from the app canvas's. There is no endpoint dot and no hit target — a spectator cannot set or clear the flag. Both flags arrive already forced to `false` unless the share token publishes bubbles, so this component applies no gate of its own.
- No selection styling, no travel animation, and no connection-detail popover — the app's version fetches a session-gated mass log.

### Depends On
- `@xyflow/react` (`BaseEdge`, `EdgeLabelRenderer`, `getBezierPath`, `getSmoothStepPath`, `Position`)
- `@/components/map/useEdgeAnchors` — per-edge face-fan attachment points (shared with the app's `ConnectionEdge`)
- `@/components/map/styling` (`connectionStyle`, `connectionBadges`, `systemClassColor`)
- `@/components/map/ConnectionBubble` — the bubble ring + wash visual (shared with the app's `ConnectionEdge`)
- `@base-ui/react/tooltip`, `lucide-react` (`RefreshCw`, `Shield`)
- Type `PublicMapConnectionEdge` from `@/types`

### Local State
- `hovered: boolean` — whether the pointer is over the edge; this or `data.highlighted` reveals the sig tags.
