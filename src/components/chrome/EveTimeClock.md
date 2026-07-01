## EveTimeClock

**Purpose:** Header widget showing the live EVE time (UTC) with a downtime highlight and a per-timezone-bloc popover.
**File:** `src/components/chrome/EveTimeClock.tsx`

### Renders
An inline bordered monospaced clock pill showing the EVE time (24h UTC) as `EVE HH:MM`. In the hour before CCP downtime the pill turns orange and appends a `DT-Xm` countdown; inside the padded downtime window it appends `Scheduled Downtime`. Clicking opens a popover with a `Downtime in HH:MM` countdown to the next downtime, then a rule and each player timezone bloc (AU / EU / US) with its local weekday and local wall-clock range.

### Behaviour & Interactions
- Re-renders on each UTC minute rollover, driven by a shared `useSyncExternalStore` tick store; the popover contents recompute on the same cadence while open.
- Renders a `--:--` placeholder on the server / until the first client snapshot, so no live time is emitted during SSR (avoids a hydration mismatch).
- Phase and countdown come from `eveClockPhase` / `minutesUntilDowntime`; the widget takes no props and needs no server data.

### Emits / Calls
- `eveTimezoneRows(now)` — exported pure helper returning `{ key, weekday, range }` per bloc for the popover (bloc offsets are standard-time whole hours; DST is not modelled).

### Depends On
- `eveClockPhase`, `minutesUntilDowntime` (`src/lib/esi/downtime.ts`)
- `Popover` / `PopoverTrigger` / `PopoverContent` (`@/components/ui/popover`)
