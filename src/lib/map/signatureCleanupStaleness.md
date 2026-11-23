## signatureCleanupStaleness.ts

**Purpose:** Map stale signature indicators to per-system ids for cleanup filters.
**File:** `src/lib/map/signatureCleanupStaleness.ts`

---

### staleSignatureMapSystemIds(signatures, systemIsWormhole, prefs, nowMs?)
Returns `mapSystemId` values flagged stale by the same rules as map signature indicators.
