## MapUnderglowBridge

**Purpose:** Bridges incoming `systemNotification` realtime events to the underglow store — resolves the event's EVE solar-system id to a map node and triggers its glow with the kind's preset.
**File:** `src/components/map/MapUnderglowBridge.tsx`

### Props
| Prop | Type | Required | Description |
|---|---|---|---|
| systems | MapSystemNode[] | yes | Current map systems; used to resolve `systemId` (EVE) → `id` (`ap_map_system.id`). Read via a ref so the effect subscription doesn't churn. |
| mapId | string | yes | The open map's id (`viewData.map.id`); guards against a foreign-map envelope. |

### Renders
Nothing.

### Behaviour & Interactions
- Registers a `useRealtimeEvents` listener; on `task === 'systemNotification'`, drops the envelope if its `mapId` is present and does not match `mapId` (defense-in-depth against a SharedWorker routing regression — the worker itself already scopes delivery to subscribed ports), validates with `systemNotificationLoadSchema`, finds the node whose `systemId` matches `load.systemId`, and calls `store.trigger(node.id, UNDERGLOW_PRESETS[load.kind])`. Kind-agnostic — `killmail` (red) and `ping` (sky-blue) both flow through here; the preset registry owns the look.
- Mirrors `TravelBridge` (systems via ref). Mounted by `MapCanvas` inside `MapUnderglowProvider`.
- Every envelope is delivered exactly once via the listener registry, so a same-tick burst of notifications all fire (no coalescing drop).

### Depends On
- `@/lib/realtime/useRealtime` (`useRealtimeEvents`), `@/lib/realtime/protocol` (`systemNotificationLoadSchema`, `Envelope`), `./MapUnderglowContext` (`useUnderglowStore`), `./underglowPresets` (`UNDERGLOW_PRESETS`), `@/lib/map/loadMap` (`MapSystemNode`).
