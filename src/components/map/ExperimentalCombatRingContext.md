## ExperimentalCombatRingContext

**Purpose:** In-memory store of per–map-system combat ring expiry times for experimental kill pulses on the map canvas.
**File:** `src/components/map/ExperimentalCombatRingContext.tsx`

### Exports
- `ExperimentalCombatRingProvider` — wraps the map canvas subtree.
- `useExperimentalCombatRingActive(mapSystemId)` — whether the ring should render.
- `useExperimentalCombatRingActions().markKill(mapSystemId)` — extends the ring window.
