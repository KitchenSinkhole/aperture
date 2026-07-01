## downtime.ts

**Purpose:** Decide whether a given instant falls inside CCP's daily ESI-downtime window, so the client can treat failures there as expected rather than real faults.
**File:** `src/lib/esi/downtime.ts`

Window = `CCP_SSO_DOWNTIME` ± `CCP_SSO_DOWNTIME_WINDOW_MIN`, padded by `CCP_SSO_DOWNTIME_BUFFER_MIN` each side. All UTC.

---

### inDowntimeWindow(at?: Date): boolean
Returns true when `at` (default `now`) is within the padded downtime window. Uses circular minute-of-day distance so a window straddling midnight is handled. Downtime failures are excluded from breaker counting and surface as `EsiDowntimeError`.

---

### PRE_DOWNTIME_MIN: number
The "hour before downtime" window (60) that the Eve-time clock highlights.

---

### minutesUntilDowntime(at?: Date): number
Whole minutes until the next `CCP_SSO_DOWNTIME` (UTC), wrapping past midnight so the result is always `1..1440`. At exactly the downtime minute it returns `1440`; callers use `inDowntimeWindow` to detect "downtime now".

---

### eveClockPhase(at?: Date): EveClockPhase
Clock display phase: `'pre'` when within `PRE_DOWNTIME_MIN` of downtime, `'downtime'` inside the padded window, else `'normal'`. `'pre'` is evaluated first, so the countdown flips to `'downtime'` at the downtime minute rather than at the window's padded leading edge.
