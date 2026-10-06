## SystemNotificationSoundBridge

**Purpose:** Plays the kill cue for a zKB kill and the ping cue for a system ping in a system on the open map.
**File:** `src/components/map/SystemNotificationSoundBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The open map's id; guards against a foreign-map envelope. |
| systems | MapSystemNode[] | yes | Current visible systems; a notification for a system not among them stays silent. |

### Renders
Nothing.

### Behaviour & Interactions
- Mounted by `MapCanvas` only when the master switch is on and `killInSystem` or `systemPinged` is enabled. The engine gates each event on its own switch, plus mute, unlock, map leadership and coalescing, so a burst of kills inside the coalesce window makes one sound and a kill never suppresses a ping.
- Registers a `useRealtimeEvents` listener; on `task === 'systemNotification'`, validates with `systemNotificationLoadSchema` and plays `killInSystem` for `kind === 'killmail'` and `systemPinged` for `kind === 'ping'`, provided the load's `mapId` matches `mapId` (defense-in-depth against a SharedWorker routing regression) and its system is in `systems`.
- The membership check covers the server's system-to-map index trailing a removal, so a notification for a system just taken off the map is silent, as its underglow is.
- The pinger receives their own ping's echo, so they hear the cue too.
- `systems` is read through a ref so the listener never churns.
- Reads the same envelopes `MapUnderglowBridge` turns into the red and blue glows; the two are independent listeners on one delivery.

### Emits / Calls
- `getSoundEngine().play('killInSystem' | 'systemPinged')`

### Depends On
- `@/lib/realtime/useRealtime` (`useRealtimeEvents`), `@/lib/realtime/protocol` (`systemNotificationLoadSchema`, `Envelope`, `SystemNotificationLoad`), `@/lib/sounds/engine` (`getSoundEngine`).
