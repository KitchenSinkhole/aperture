## PresenceSoundBridge

**Purpose:** Plays the arrive or leave cue when a tracked pilot jumps into or out of the system the viewer's active character is in.
**File:** `src/components/map/PresenceSoundBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The open map; keys the watch store. |
| systems | MapSystemNode[] | yes | Current visible systems, for resolving a jump to a connection. |
| connections | MapConnectionEdge[] | yes | Current connections, for resolving a jump to a connection. |
| viewerCharacterIds | number[] | yes | The viewer's own characters; their jumps never make a sound. |
| watchedJumpOn | boolean | yes | Whether the account has `watchedJump` enabled. |

### Renders
Nothing.

### Behaviour & Interactions
- Mounted by `MapCanvas` only when the account's master switch is on and at least one of `pilotArrived` / `pilotLeft` is enabled, so an off setting means the code path is absent. The engine still gates the individual event, mute, unlock, map leadership and coalescing.
- Must sit inside both `MapPresenceProvider` and `MapActiveCharProvider`.
- The traversal callback fires synchronously from inside `PresenceStore.apply()`, so every envelope of a same-frame burst is classified before React re-renders. The viewer's system is resolved live from the presence store (`getSystemForCharacter`) at event time; only the active character id comes from the active-char context. A pilot that follows the viewer into a new system inside one frame is therefore an arrival, not a departure.
- With `watchedJumpOn`, a jump through a connection this device watches plays nothing here: it belongs to the `watchedJump` cue alone, whose inbound/outbound variant already says it touched the viewer's system, so one jump never plays two cues. `systems` / `connections` are read through refs.
- Cues are classified against this tab's active character; with one map open in several tabs, the tab holding the map's sound lock decides.
- With no located active character, nothing plays — there is no "my system" to compare against.

### Emits / Calls
- `useTraversals(cb)` — subscribes to pilot jumps from `MapPresenceContext`.
- `useMapActiveChar()` — reads `activeCharId`.
- `usePresenceStore()` — `getSystemForCharacter(activeCharId)`, the viewer's system at event time.
- `getSoundEngine().play(event)` — `'pilotArrived'` or `'pilotLeft'`.

### Depends On
- `@/lib/sounds/presenceEvents` (`classifyTraversal`)
- `./WatchedConnectionSoundBridge` (`crossesWatchedConnection`)
- `@/lib/sounds/engine` (`getSoundEngine`)
