## experimentalSoundLayout.ts

**Purpose:** Experimental map layout fields under `panelSettings.sound` (follow-pilot toggle only).
**File:** `src/lib/experimentalSoundLayout.ts`

### ExperimentalSoundLayoutSettings
`{ followSelectedPilot?: boolean }` — when true, the map camera follows the selected pilot's jumps.

### parseExperimentalSoundLayoutSettings(layout)
Reads `layout.panelSettings.sound` into `ExperimentalSoundLayoutSettings`.

### mergeSoundPanelSettings(layout, sound)
Writes `sound` back onto `layout.panelSettings.sound`.