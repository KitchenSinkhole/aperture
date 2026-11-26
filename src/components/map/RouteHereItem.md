## RouteHereItem

**Purpose:** Experimental map context-menu entry that saves a system as a route destination (same as "Add to routes") with route-oriented copy.
**File:** `src/components/map/RouteHereItem.tsx`

### Props
| Prop | Type | Required | Description |
|---|---|---|---|
| system | MapSystemNode | yes | Right-clicked system. |
| onClose | () => void | yes | Dismisses the menu after select. |

### Behaviour
Renders nothing when experimental UI is off. On success, `publishRouteDestination` + success toast; on action failure, `toast.error`.

### Depends On
- `addRouteDestinationAction`, `publishRouteDestination`, `isExperimentalUiActive`
