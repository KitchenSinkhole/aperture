## SoundToolbarButton

**Purpose:** Map-toolbar speaker showing whether sound cues can play right now, and toggling the device mute.
**File:** `src/components/map/SoundToolbarButton.tsx`

### Props
None.

### Renders
A ghost icon button with a tooltip, in one of three states:

| State | Icon | Tooltip |
|---|---|---|
| locked (browser has not permitted audio) | amber `VolumeOff` | "Click to enable sounds" |
| muted | muted-foreground `VolumeX` | "Sounds muted on this device, click to unmute" |
| live | `Volume2` | "Sounds on, click to mute on this device" |

The tooltip text is also the button's `aria-label`.

### Behaviour & Interactions
- Subscribes to the sound engine's `SoundStatus` through `useSyncExternalStore`, so the state tracks an unlock or a mute made anywhere, including in another tab.
- The click acts on the state the gesture began in, latched on `pointerdown` / `keydown`: the engine's own document gesture listener unlocks audio on the same press and can flip the rendered state to live before the click dispatches, and a press begun while locked only asks for playback permission, never toggling mute. The engine unlocking on any document gesture also makes this button a visible affordance rather than the only route.
- Mute goes through the engine, which persists it to localStorage for the whole device.
- `MapCanvas` mounts it only when the account's master sound switch is on, so an account with sounds off has no toolbar control.

### Emits / Calls
- `getSoundEngine()` — `subscribe` / `getSnapshot` / `getServerSnapshot`, `unlock()`, `toggleMute()`

### Depends On
- `@/components/ui/button`, `@base-ui/react/tooltip`
- `getSoundEngine` from `@/lib/sounds/engine`
