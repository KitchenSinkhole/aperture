## WatchConnectionItem

**Purpose:** The "Watch this wormhole" checkbox in the connection context menu, marking a hole this device wants a jump cue for.
**File:** `src/components/map/WatchConnectionItem.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The open map; watches are stored per map. |
| connectionId | string | yes | `ap_map_connection.id` to watch. |
| scope | ConnectionScope | yes | The connection's scope; only a wormhole offers the item. |
| onClose | () => void | yes | Closes the menu after the toggle, like every other leaf action. |

### Renders
A `MenuCheckboxItem` labelled "Watch this wormhole", checked while the connection is watched on this device. Nothing at all for a non-`wh` connection that is not already watched.

### Behaviour & Interactions
- Self-contained: it reads and writes `connectionWatchPrefs` directly rather than routing through a `MapCanvas` callback, because a watch never reaches the server.
- `MapContextMenu` renders it in the `connection` block; the item itself decides whether to appear.
- Only a wormhole can be watched, but an already-watched connection keeps the item whatever its scope, so a hole reclassified as a gate can still be unwatched rather than chiming with no way to stop it.

### Depends On
- `@/lib/connectionWatchPrefs` — `useIsConnectionWatched`, `toggleConnectionWatch`.
- `@/components/ui/menu` — `MenuCheckboxItem`.
- `@/lib/map/enumLabels` — `ConnectionScope`.
