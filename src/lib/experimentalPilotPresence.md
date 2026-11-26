## experimentalPilotPresence.ts

**Purpose:** Experimental pilot-badge standing tones and class helpers for map presence UI.
**File:** `src/lib/experimentalPilotPresence.ts`

---

### pilotCountStandingTone(pilotCount: number): PilotStandingTone
Returns a standing tone for a system's online tracked pilot count. Tracked map presence is treated as friendly until killmail-derived hostility is wired.

### pilotBadgeToneClasses(tone: PilotStandingTone): string
Tailwind utility classes tinting the compact count badge ring and text.

### pilotNameToneClass(tone: PilotStandingTone): string
Text colour class for pilot names inside the hover card.

### pilotStandingFromSystemStatus(status: SystemStatus): PilotStandingTone
Maps an on-map `system_status` to a pilot standing tone for sidebar rows.

### pilotLocationFadeOpacity(locationAt: string, nowMs: number): number
Returns a 0.45–1 opacity for how long ago a pilot's `locationAt` was reported.
