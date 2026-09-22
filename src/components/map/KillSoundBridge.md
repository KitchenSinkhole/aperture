## KillSoundBridge

**Purpose:** Plays the kill cue when a zKB kill lands in a system on the open map.
**File:** `src/components/map/KillSoundBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The open map's id; guards against a foreign-map envelope. |

### Renders
Nothing.

### Behaviour & Interactions
- Mounted by `MapCanvas` only when the account's master switch is on and `killInSystem` is enabled, so an off setting means the code path is absent. The engine still gates mute, unlock, map leadership and coalescing, so a burst of kills inside the coalesce window makes one sound.
- Registers a `useRealtimeEvents` listener; on `task === 'systemNotification'`, drops the envelope if its `mapId` is present and does not match `mapId` (defense-in-depth against a SharedWorker routing regression), validates with `systemNotificationLoadSchema`, and plays only for `kind === 'killmail'` — a `ping` rides the same task and is not a kill.
- System membership needs no resolution: the server fans a `systemNotification` only to maps holding that system.
- Reads the same envelope `MapUnderglowBridge` turns into the red glow; the two are independent listeners on one delivery.

### Emits / Calls
- `getSoundEngine().play('killInSystem')`

### Depends On
- `@/lib/realtime/useRealtime` (`useRealtimeEvents`), `@/lib/realtime/protocol` (`systemNotificationLoadSchema`, `Envelope`), `@/lib/sounds/engine` (`getSoundEngine`).
