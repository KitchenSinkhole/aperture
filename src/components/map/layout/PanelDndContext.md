## PanelDndContext

**Purpose:** dnd-kit `DndContext` wrapping the map dashboard grid, driving tab drag (reorder + merge) while coexisting with react-grid-layout's whole-cell drag.
**File:** `src/components/map/layout/PanelDndContext.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| onDragEnd | (activePanel: PanelId, overId: string) => void | yes | Fired when a tab drag settles over a target; `overId` is the raw droppable id (`grp:<groupId>` header or a bare `PanelId` tab). A drop with no target is swallowed. |
| children | ReactNode | yes | The grid; its tabs (draggables) and headers (droppables) register against this context. |

### Renders
Its `children` plus a `DragOverlay` showing the dragged panel's title (resolved from `PANELS`) as a floating ghost while a drag is active.

### Behaviour & Interactions
- `PointerSensor` with a 5px activation distance, so a plain tab click still fires the tab's `onClick` (switch) rather than starting a drag.
- Collision detection is `pointerWithin` with the grid surface (`GRID_DROPPABLE_ID`) deprioritised: when the pointer is over both a group header/tab and the grid surface, the header/tab wins; the grid surface is the `over` only when the pointer is outside every header. This partitions merge/reorder (header/tab drops) from tear-off (open-grid drops, handled by `MapLayoutGrid`).
- Tracks the active panel id locally between `onDragStart` and `onDragEnd`/`onDragCancel` to feed the overlay; on end it reports `active.id` + `over.id` upward and clears the overlay.
- Passes a fixed `id` to `DndContext` so each tab's accessibility `aria-describedby` is identical on the server and client — dnd-kit's default id is a module-global counter that diverges across SSR/hydration.

### Depends On
- `@dnd-kit/core` — `DndContext`, `DragOverlay`, `PointerSensor`, `pointerWithin`, `useSensor`/`useSensors`.
- `GRID_DROPPABLE_ID` (`./MapLayoutGrid`) — the grid-surface droppable id its collision detection deprioritises.
- `PANELS` (`@/lib/map/layout/panels`) — resolves the overlay title.
