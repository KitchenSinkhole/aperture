## prefsSync.ts

**Purpose:** Carries a saved `SoundPrefs` blob to the device's other open tabs, so a settings change reaches every tab without a reload.
**File:** `src/lib/sounds/prefsSync.ts`

One `BroadcastChannel` per tab serves both directions, so a tab never hears its own announcement. Where `BroadcastChannel` is unavailable both functions are no-ops. Only same-device tabs are reached; another device picks the change up on its next render.

---

### SOUND_PREFS_CHANNEL
The `BroadcastChannel` name the prefs travel on.

### announceSoundPrefs(prefs: SoundPrefs): void
Posts `prefs` to every other tab on the device. Called by `AccountSettingsDialog` after a successful save.

### subscribeSoundPrefs(listener: (prefs: SoundPrefs) => void): () => void
Receives prefs another tab announced; returns an unsubscribe fn.
