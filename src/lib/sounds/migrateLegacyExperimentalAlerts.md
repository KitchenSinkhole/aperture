## migrateLegacyExperimentalAlerts.ts

**Purpose:** Moves deprecated device-local experimental alert toggles into the account `SoundPrefs` blob and clears the old keys.
**File:** `src/lib/sounds/migrateLegacyExperimentalAlerts.ts`

### migrateLegacyExperimentalAlerts(prefs): SoundPrefs
Reads legacy `localStorage` flags once, merges into `rallySet`, `activeRouteOffRoute`, and `activeRouteLinkAlert`, removes keys, and returns the updated prefs (unchanged when no legacy flags were set).