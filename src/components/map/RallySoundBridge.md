## RallySoundBridge

**Purpose:** Plays `rallySet` when a system on the map gets a rally point; optional experimental toast and desktop notification from account prefs.
**File:** `src/components/map/RallySoundBridge.tsx`

### Behaviour
- Sound plays when `shouldPlaySystemSound` allows (per-system mute) and the engine master/event gates pass.
- In-app toast when experimental UI is on and `shouldShowExperimentalAlertToast` is true for the rally row (independent of master and per-system mutes).
- Desktop notification when experimental UI is on, sound gate allows, and `desktopNotification` is enabled on the row.