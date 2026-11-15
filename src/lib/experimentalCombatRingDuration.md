## experimentalCombatRingDuration.ts

**Purpose:** Device-local combat ring duration (minutes) for the experimental UI; `0` disables new rings.
**File:** `src/lib/experimentalCombatRingDuration.ts`

---

### clampExperimentalCombatRingMinutes(raw: number): number
Clamps to 0–60; non-finite values use the default (10).

---

### readExperimentalCombatRingMinutes(): number
Reads `aperture:experimental:combat-ring-minutes` from `localStorage`.

---

### readExperimentalCombatRingMs(): number
Minutes converted to milliseconds; returns `0` when duration is off.

---

### writeExperimentalCombatRingMinutes(minutes: number): void
Persists clamped minutes and dispatches `aperture:experimental-combat-ring-duration`.