## experimentalAutoMass.ts

**Purpose:** Derive wormhole `massStatus` from logged cumulative jump mass vs total hole mass (experimental QoL c).
**File:** `src/lib/experimentalAutoMass.ts`

---

### massStatusFromRemainingPercent(remainingPercent: number): WhMass
Band thresholds aligned with inspector labels (50% / 10%).

### massStatusFromCumulative(cumulativeMassKg, totalMassKg): WhMass | null
Returns null when total mass is unknown.
