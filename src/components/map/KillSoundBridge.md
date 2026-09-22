## KillSoundBridge

**Purpose:** Plays the kill cue when a zKB kill lands in a system on the open map.
**File:** `src/components/map/KillSoundBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The open map's id; guards against a foreign-map envelope. |
| systems | MapSystemNode[] | yes | Current visible systems; a notification for a system not among them stays silent. |

### Renders
Nothing.

### Behaviour & Interactions
- Mounted by `MapCanvas` only when the account's master switch is on and `killInSystem` is enabled, so an off setting means the code path is absent. The engine still gates mute, unlock, map leadership and coalescing, so a burst of kills inside the coalesce window makes one sound.
- Registers a `useRealtimeEvents` listener; on `task === 'systemNotification'`, validates with `systemNotificationLoadSchema` and plays only for `kind === 'killmail'` (a `ping` rides the same task and is not a kill) whose load `mapId` matches `mapId` (defense-in-depth against a SharedWorker routing regression) and whose system is in `systems`.
- The membership check covers the server's system-to-map index trailing a removal, so a kill in a system just taken off the map is silent, as its underglow is.
- `systems` is read through a ref so the listener never churns.
- Reads the same envelope `MapUnderglowBridge` turns into the red glow; the two are independent listeners on one delivery.

### Emits / Calls
- `getSoundEngine().play('killInSystem')`

### Depends On
- `@/lib/realtime/useRealtime` (`useRealtimeEvents`), `@/lib/realtime/protocol` (`systemNotificationLoadSchema`, `Envelope`), `@/lib/sounds/engine` (`getSoundEngine`).
