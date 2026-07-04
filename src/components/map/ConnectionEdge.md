## ConnectionEdge

**Purpose:** xyflow custom edge rendering a map connection with scope/mass colouring, EOL dashing, state badges, and a selected-state highlight.
**File:** `src/components/map/ConnectionEdge.tsx`

### Props
xyflow `EdgeProps` with `data: ConnectionEdgeData` (`MapConnectionEdge & { parallelIndex: number; parallelCount: number; mapId: string; wormholeTypeId: number | null; wormholeCode: string | null }`) and `selected`. `mapId` + the resolved source-wormhole `wormholeTypeId`/`wormholeCode` feed the detail popover (populated in `MapCanvas`'s edge memo).

### Renders
A `BaseEdge` styled via `connectionStyle` (scope→colour, wormhole recoloured by mass, EOL dashed — tighter for the critical stage, frigate thinned). The path geometry is scope-dependent: `stargate` (gate) links render as a right-angled orthogonal `getSmoothStepPath` (`borderRadius: 0`) so they read distinctly from the smooth `getBezierPath` used by wormhole / jumpbridge / abyssal connections. Plus a midpoint label laid out as a vertical stack: a **"do not jump" flag row** sits *above* a text-badge row. The flag row carries large red `DoNotJumpFlag` badges (filled red circle, white glyph, `RefreshCw` for `isRolling`, `Shield` for `preserveMass`) each with a hover/focus tooltip spelling out why the hole must not be jumped — these are the loudest thing on the edge. The text-badge row (`text-[11px]`) carries `connectionBadges` (STATIC, jump-mass size, `EOL`/`EOL 1h`); the small (`s`) size badge renders as a filled amber warning pill so undersized holes aren't missed. The badge row is the hover trigger for `ConnectionDetailPopover` (wormhole type / masses / lifetime / logged mass / EOL countdown). When a travel pulse is active for this connection, a faint `TravelDot` (SVG `<circle>` r 5, opacity 0.55, edge stroke colour) with an `<animateMotion>` glides once along the curve.

### Behaviour & Interactions
- Selectable by click — `MapCanvas` consumes `onSelectionChange` and routes the selected edge into the sidebar inspector.
- When `selected`, the stroke thickens by 1.5 px and a `drop-shadow` glow is applied in the current stroke colour to surface which edge the inspector is editing.
- The label wrapper is `pointer-events-none` so clicks hit the path; the badge cluster and the do-not-jump flags re-enable pointer events on themselves (`pointer-events-auto`) so their hover popovers/tooltips work.
- The EOL countdown no longer renders on the edge; it lives inside `ConnectionDetailPopover` (opened by hovering the badge cluster).
- Edits all live in the sidebar inspector (`InspectorModule.ConnectionInspector`).
- Endpoint sides snap dynamically: `pickAnchors` reads source/target node geometry from `useInternalNode`, compares the centre-to-centre delta, and picks the dominant axis. `|dx| >= |dy|` → right/left; otherwise → bottom/top, oriented so the source side faces the target. The `sourceX/Y/Position` and `targetX/Y/Position` props xyflow passes (which derive from whichever handles the connection was created on) are only used as a fallback while the nodes haven't been measured yet.
- Parallel edges (multiple wormholes between the same two systems): `parallelIndex`/`parallelCount` from `ConnectionEdgeData` drive a perpendicular `offset` passed to `pickAnchors` — 12 px per step, centred around 0. For two parallel connections the offsets are −6/+6 px; for three: −12/0/+12 px. The offset shifts the anchor along the node face so each line exits from a visually distinct point.
- **Travel animation:** `useTravelForConnection(id)` (from `MapTravelContext`) returns the current pulse (`{ direction, token }`) or null. When set, a `TravelDot` keyed by `token` mounts (a fresh jump remounts it). The dot's `<animateMotion>` follows the same bezier `path` source→target by default; `direction === 'reverse'` traverses it backwards via `keyPoints="1;0"`. The pulse self-clears after ~1.3s (managed by the store). No pulse ever fires when the account has the animation disabled (the bridge that emits them isn't mounted).
  - The SMIL animation is started imperatively via `beginElement()` in a mount effect (with `begin="indefinite"`), **not** the default `begin="0s"`. A SMIL begin offset is resolved against the SVG document timeline (page load); on a long-lived canvas "0s" is already in the past when a jump occurs, so the browser would render the animation as already-finished — the dot snaps to the curve's end (`fill="freeze"`) and never visibly moves. `beginElement()` starts it at the current document time.

### Depends On
- `@xyflow/react` (`BaseEdge`, `EdgeLabelRenderer`, `Position`, `getBezierPath`, `getSmoothStepPath`, `useInternalNode`, `EdgeProps`).
- `@base-ui/react/tooltip` (`Tooltip`) for the do-not-jump flag tooltips.
- `lucide-react` (`RefreshCw` rolling icon, `Shield` preserve-mass icon, `LucideIcon` type).
- `./styling` for stroke + badge calculation.
- `./ConnectionDetailPopover` — hover popover wrapping the badge cluster.
