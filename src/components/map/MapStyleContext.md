## MapStyleContext

**Purpose:** Supplies active map colour palette options to canvas nodes and overlays while experimental UI is on.
**File:** `src/components/map/MapStyleContext.tsx`

### `MapStyleProvider`

Wraps the map canvas; `value` is a `MapStyleOptions` from `@/components/map/styling`.

### `useMapStyleOptions()`

Returns the nearest provider value, defaulting to `{ palette: 'default', theme: 'dark' }`.
