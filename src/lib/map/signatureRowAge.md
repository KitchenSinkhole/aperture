## signatureRowAge.ts

**Purpose:** Maps signature `updatedAt` to experimental table row age tiers and CSS class names.
**File:** `src/lib/map/signatureRowAge.ts`

---

### signatureRowAgeTier(updatedAtIso, nowMs?)
Returns `fresh`, `warm` (≥ 2h), or `stale` (≥ 8h).

### signatureRowAgeClass(tier)
Returns the experimental table row class for the tier (`ap-sig-age-warm` / `ap-sig-age-stale`), or empty for fresh.
