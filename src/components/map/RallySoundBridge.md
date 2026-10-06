## RallySoundBridge

**Purpose:** Plays the rally cue when a rally point is set on a system of the open map.
**File:** `src/components/map/RallySoundBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The open map's id; an envelope whose load names another map is dropped. |

### Renders
Nothing.

### Behaviour & Interactions
- Mounted by `MapCanvas` only when the account's master switch is on and `rallySet` is enabled, so an off setting means the code path is absent. The engine still gates mute, unlock, map leadership and coalescing.
- Registers a `useRealtimeEvents` listener; on `task === 'mapUpdate'`, validates with `mapUpdateLoadSchema`, checks the load's `mapId`, and plays only for a `system.updated` payload carrying a non-null `rallyAt`. Clearing a rally is silent.
- The viewer who set the rally hears the cue too: the canvas's own-echo dedupe guards only its state apply, not this listener.

### Emits / Calls
- `getSoundEngine().play('rallySet')`

### Depends On
- `@/lib/realtime/useRealtime` (`useRealtimeEvents`), `@/lib/realtime/protocol` (`mapUpdateLoadSchema`, `Envelope`), `@/lib/sounds/engine` (`getSoundEngine`).
