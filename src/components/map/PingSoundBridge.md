## PingSoundBridge

**Purpose:** Plays the ping cue when someone pings a system on the open map.
**File:** `src/components/map/PingSoundBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The open map's id; guards against a foreign-map envelope. |
| systems | MapSystemNode[] | yes | Current visible systems; a notification for a system not among them stays silent. |

### Renders
Nothing.

### Behaviour & Interactions
- Mounted by `MapCanvas` only when the account's master switch is on and `systemPinged` is enabled, so an off setting means the code path is absent. The engine still gates mute, unlock, map leadership and coalescing.
- Registers a `useRealtimeEvents` listener; on `task === 'systemNotification'`, validates with `systemNotificationLoadSchema` and plays only for `kind === 'ping'` whose load `mapId` matches `mapId` and whose system is in `systems` (read through a ref). A `killmail` rides the same task and belongs to `KillSoundBridge`.
- The pinger receives its own echo, so they hear the cue too.

### Emits / Calls
- `getSoundEngine().play('systemPinged')`

### Depends On
- `@/lib/realtime/useRealtime` (`useRealtimeEvents`), `@/lib/realtime/protocol` (`systemNotificationLoadSchema`, `Envelope`), `@/lib/sounds/engine` (`getSoundEngine`).
