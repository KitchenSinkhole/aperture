## SpectatorMap

**Purpose:** The xyflow canvas for a public share — the chain rendered straight off the redacted snapshot, with no interaction layer.
**File:** `src/components/public/SpectatorMap.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| data | PublicMapViewData | yes | The redacted snapshot. |
| highlightedSystemId | string \| null | yes | `ap_map_system.id` of the entrance row under the cursor; that node renders a halo. |

### Renders
`<ReactFlowProvider>` wrapping a `<ReactFlow>` with `<Background/>` and `<Controls showInteractive={false} position="bottom-right"/>`, plus a Base UI `Tooltip.Provider` for the node and edge hovers. Node type `system` → `PublicSystemNode`; edge type `connection` → `PublicConnectionEdge`. Both maps are module-scope constants, as xyflow requires.

### Behaviour & Interactions
- Nodes and edges are plain `useMemo` derivations of `data` — no controlled node state, no change handlers. Dragging, connecting, selection and the delete key are all off.
- Auto-fits on mount with a padded `fitView` capped at a modest max zoom. Legibility at stream resolution comes from that zoom rather than from enlarging node type, which would widen tiles and break the positions the map's authors arranged them in.
- Presence is indexed by EVE solar-system id at whatever fidelity the token published (`anonymous` counts plus hull-class buckets, or the `full` pilot list) and handed to each node.
- A node's `highlighted` flag is set by either the `highlightedSystemId` prop (board-row hover) or by being an endpoint of `hoveredConnectionId` (edge hover, reported up via each connection's `onHoverChange`) — the two sources merge into one highlight set so a hovered hole rings both of its tiles the same way a hovered board row rings its one.
- Each connection's edge data carries `endpointSecurity`, each end's `universe_system.security` label looked up from `data.systems`, for `PublicConnectionEdge` to tint its sig tags with the far system's class.

### Depends On
- `@xyflow/react` (`ReactFlow`, `ReactFlowProvider`, `Background`, `Controls`)
- `@base-ui/react/tooltip` (`Tooltip.Provider`)
- `PublicSystemNode`, `PublicConnectionEdge`
- Types `PublicMapViewData`, `PublicMapPresence` from `@/types`

### Local State
- `hoveredConnectionId: string | null` — the connection under the pointer, feeding the merged node highlight set.
