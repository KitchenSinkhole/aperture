## PresenceSoundBridge

**Purpose:** Plays the arrive or leave cue when a tracked pilot jumps into or out of the system the viewer's active character is in.
**File:** `src/components/map/PresenceSoundBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| viewerCharacterIds | number[] | yes | The viewer's own characters; their jumps never make a sound. |

### Renders
Nothing.

### Behaviour & Interactions
- Mounted by `MapCanvas` only when the account's master switch is on and at least one of `pilotArrived` / `pilotLeft` is enabled, so an off setting means the code path is absent. The engine still gates the individual event, mute, unlock, map leadership and coalescing.
- Must sit inside both `MapPresenceProvider` and `MapActiveCharProvider`.
- The traversal callback fires synchronously from inside `PresenceStore.apply()`, so every envelope of a same-frame burst is classified before React re-renders. The viewer's system is resolved live from the presence store (`getSystemForCharacter`) at event time; only the active character id comes from the active-char context. A pilot that follows the viewer into a new system inside one frame is therefore an arrival, not a departure.
- With no located active character, nothing plays — there is no "my system" to compare against.

### Emits / Calls
- `useTraversals(cb)` — subscribes to pilot jumps from `MapPresenceContext`.
- `useMapActiveChar()` — reads `activeCharId`.
- `usePresenceStore()` — `getSystemForCharacter(activeCharId)`, the viewer's system at event time.
- `getSoundEngine().play(event)` — `'pilotArrived'` or `'pilotLeft'`.

### Depends On
- `@/lib/sounds/presenceEvents` (`classifyTraversal`)
- `@/lib/sounds/engine` (`getSoundEngine`)
