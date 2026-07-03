## MapLayoutGrid

**Purpose:** Thin wrapper around react-grid-layout's `Responsive` grid that supplies container-width measurement, the project's breakpoints/cols, the header-only drag handle, and a mount guard.
**File:** `src/components/map/layout/MapLayoutGrid.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| layouts | Record<Breakpoint, Layout> | yes | Per-breakpoint arrangements; each item's `i` matches a child's `key` (a group id) |
| onLayoutChange | (current: Layout, all: ResponsiveLayouts<Breakpoint>) => void | yes | Fired by RGL on every drag/resize with the active and all-breakpoint layouts |
| onBreakpointChange | (bp: Breakpoint) => void | no | Fired once mounted and whenever the measured width crosses into a new breakpoint |
| onTearOff | (panel: PanelId, x: number, y: number) => void | no | Fired when a tab is dropped on the open grid surface, with the snapped target cell in grid units |
| children | ReactNode | yes | One element per visible group, each keyed by its group id |

### Renders
A relative-positioned wrapper `div` holding either the live `Responsive` grid (once measured) or a plain vertical stack of `children` (first paint, before width is known), plus a dashed placement-ghost outline while a tab is dragged over the grid surface.

### Behaviour & Interactions
- Width comes from RGL's `useContainerWidth` (ResizeObserver) — no `WidthProvider`, SSR-safe. `mounted` gates the grid to avoid a hydration flash; the stacked fallback renders until then.
- `dragConfig={{ handle: '.ap-panel-drag', cancel: '.nodrag' }}` — only `MapPanelGroup` headers start a drag; tabs and controls marked `nodrag` are excluded.
- Computes the active breakpoint from the measured width (largest `PANEL_BREAKPOINTS` min-width that fits) and reports it via `onBreakpointChange` in an effect once `mounted`, so the parent picks the matching per-breakpoint grouping with a definite initial value.
- `rowHeight` 40px, `margin` and `containerPadding` both [8, 8]px (padding passed explicitly so RGL's placement math — reused for the tear-off ghost — is fully determined by these constants, not RGL's implicit `containerPadding ?? margin` default). Breakpoints/cols come from `PANEL_BREAKPOINTS` / `PANEL_COLS`.
- Re-applies `PANEL_MIN` (registry resize floors) over each stored layout item before handing `layouts` to RGL, so the registry `minW`/`minH` stay authoritative — lowering a floor takes effect for already-saved layouts without altering their persisted `x/y/w/h`.
- **Tab tear-off (dnd-kit):** the whole grid area is a `useDroppable` (`GRID_DROPPABLE_ID`) whose ref is merged onto the ResizeObserver container, so its drop rect equals the grid. A `useDndMonitor` tracks the drag: while a tab hovers the grid surface (its `over` is `GRID_DROPPABLE_ID` — only when the pointer is over no header, per `PanelDndContext`'s collision detection), the live pointer (`activatorEvent` client point + accumulated `delta`, minus the container rect) is snapped to a grid cell via RGL's `calcXY`, sized to the dragged panel's `PANEL_MIN` footprint, and drawn as a dashed ghost outline positioned by RGL's `calcGridItemPosition`. On drop over the surface it re-derives the cell and calls `onTearOff(panel, x, y)`; the parent creates the new cell. RGL settles any resulting overlap via its normal compaction.
- Imports `react-grid-layout/css/styles.css` for the grid item / resize-handle positioning.
- Stateless w.r.t. layout: holds no layout state (the parent owns `layouts` and persists via `onLayoutChange`); only transient tear-off ghost state is local.

### Exports
- `MapLayoutGrid` — the component.
- `GRID_DROPPABLE_ID` — the grid-surface droppable id, shared with `PanelDndContext`'s collision detection.

### Depends On
- `react-grid-layout` (`Responsive`, `useContainerWidth`, `calcXY`, `calcGridItemPosition`, `Layout`, `ResponsiveLayouts`).
- `@dnd-kit/core` (`useDroppable`, `useDndMonitor`) — the grid-surface drop target + drag tracking for tear-off.
- `PANEL_BREAKPOINTS` / `PANEL_COLS` / `PANEL_MIN` from `@/lib/map/layout/panels`.
- `PANEL_DRAG_HANDLE_CLASS` / `PANEL_NO_DRAG_CLASS` from `./MapPanelGroup`.
