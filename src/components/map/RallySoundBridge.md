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
- Mounted by `MapCanvas` only when the account's master switch is on and `rallySet` is enabled. Respects `ExperimentalSoundGate` per-system mutes when experimental UI is on.
- On rally set: plays `rallySet`. With experimental UI, shows an in-app toast; when `rallySet.desktopNotification` is true and permission is granted, also fires a browser `Notification`.

### Emits / Calls
- `getSoundEngine().play('rallySet')`, `toast.message`, optional `Notification`

### Depends On
- `@/lib/realtime/useRealtime` (`useRealtimeEvents`), `@/lib/realtime/protocol` (`mapUpdateLoadSchema`, `Envelope`), `@/lib/sounds/engine` (`getSoundEngine`).
