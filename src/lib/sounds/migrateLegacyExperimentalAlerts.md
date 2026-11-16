## migrateLegacyExperimentalAlerts.ts

**Purpose:** Moves deprecated device-local experimental alert toggles into the account `SoundPrefs` blob and clears the old keys.
**File:** `src/lib/sounds/migrateLegacyExperimentalAlerts.ts`

### migrateLegacyExperimentalAlerts(prefs): SoundPrefs
Reads legacy `localStorage` flags once. Rally toast maps to `rallySet.toast`; rally desktop to `desktopNotification`. Route legacy keys enable the matching event rows. Clears keys; returns prefs unchanged when none were set.