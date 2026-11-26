## RallySoundBridge.tsx

**Purpose:** Plays the `rallySet` sound cue when any system on the open map gets a rally point, with optional experimental toast and desktop notification.
**File:** `src/components/map/RallySoundBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Open map id |
| systems | MapSystemNode[] | yes | Current systems for EVE id / Home resolution |
| homeMapSystemId | string \| null | yes | Home `ap_map_system.id` for mute resolution |

### Behaviour & Interactions
- Subscribes to `mapUpdate` envelopes; fires on `system.updated` with non-null `rallyAt` only.
- Chime uses `getSoundEngine().play('rallySet', { system })` so upstream `sound_prefs` mutes apply.
- Experimental UI: toast when `shouldShowExperimentalAlertToast` for `rallySet`; desktop when `desktopNotification` and alerts are not muted for that system.

### Emits / Calls
- `useRealtimeEvents` — realtime subscription
- `getSoundEngine().play` — cue playback