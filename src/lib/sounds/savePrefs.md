## savePrefs.ts

**Purpose:** The one save path for the account's sound prefs, shared by the account settings dialog and the map's system menu.
**File:** `src/lib/sounds/savePrefs.ts`

---

### saveSoundPrefs(next: SoundPrefs, prev: SoundPrefs): Promise\<boolean>
Applies `next` to the engine immediately (`getSoundEngine().setPrefs`), then persists it through `setSoundPrefsAction`. On success it announces `next` to the device's other tabs (`announceSoundPrefs`). On failure it toasts the action's error and restores `prev` in the engine, but only while the engine still holds `next`, so a failed save never undoes a newer edit made in the meantime.

**Parameters:**
- `next` — the full blob to save
- `prev` — what the engine goes back to if the save fails

**Returns:** Whether the save landed.
