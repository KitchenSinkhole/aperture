## SpectatorMap

**Purpose:** The xyflow canvas for a public share — the chain rendered straight off the redacted snapshot, with no interaction layer.
**File:** `src/components/public/SpectatorMap.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| data | PublicMapViewData | yes | The redacted snapshot. |
| highlight | SpectatorHighlight | yes | The route currently lit — `systemIds` to ring and `connectionIds` to lift. |
| onPaneClick | () => void | yes | Fires on a click off the chain, so the owner can dismiss a pinned route. |

`SpectatorHighlight` (exported here) is `{ systemIds: string[]; connectionIds: string[] }`.

### Renders
`<ReactFlowProvider>` wrapping a `<ReactFlow>` with `<Background/>` and `<Controls showInteractive={false} position="bottom-right"/>`, plus a Base UI `Tooltip.Provider` for the node and edge hovers. Node type `system` → `PublicSystemNode`; edge type `connection` → `PublicConnectionEdge`. Both maps are module-scope constants, as xyflow requires.

### Behaviour & Interactions
- Nodes and edges are plain `useMemo` derivations of `data` — no controlled node state, no change handlers. Dragging, connecting, selection and the delete key are all off.
- Auto-fits on mount with a padded `fitView` capped at a modest max zoom; the controls' fit button uses the same options, so it restores the arrival view. Legibility at stream resolution comes from that zoom rather than from enlarging node type, which would widen tiles and break the positions the map's authors arranged them in.
- The zoom floor sits far below xyflow's default, since `fitView` clamps to it and a long chain on a phone needs to fit below 0.5. Navigation is the canvas's own: the wheel zooms, and on a touch device one finger pans and two pinch (`.spectator .react-flow__renderer` takes `touch-action: none` in `globals.css`, as the spectator shell has nothing to scroll).
- Presence is indexed by EVE solar-system id at whatever fidelity the token published (`anonymous` counts plus hull-class buckets, or the `full` pilot list) and handed to each node.
- The `highlight` prop and `hoveredConnectionId` (edge hover, reported up via each connection's `onHoverChange`) merge into one lit set rather than running as parallel channels, so a hovered hole and a lit route read identically. Every connection in the merged set marks its edge `highlighted` and rings both of its endpoint tiles; `highlight.systemIds` rings on top of that, which is what carries a route's k-space starting system.
- Each connection's edge data carries `endpointSecurity`, each end's `universe_system.security` label looked up from `data.systems`, for `PublicConnectionEdge` to tint its sig tags with the far system's class.

### Depends On
- `@xyflow/react` (`ReactFlow`, `ReactFlowProvider`, `Background`, `Controls`)
- `@base-ui/react/tooltip` (`Tooltip.Provider`)
- `PublicSystemNode`, `PublicConnectionEdge`
- Types `PublicMapViewData`, `PublicMapPresence` from `@/types`

### Local State
- `hoveredConnectionId: string | null` — the connection under the pointer, feeding the merged lit set.
