## experimentalSignatureCleanupMatch.ts

**Purpose:** Shared signature matching for experimental Clean up (dialog preview and automatic cleanup).
**File:** `src/lib/map/experimentalSignatureCleanupMatch.ts`

---

### matchSignaturesForExperimentalCleanup(input): MapSignature[]
Applies `SignatureCleanupPanelSettings` (scope, age, groups, stale/unscanned/WH-expired filters) to the live signature list; returns an empty list when scope is `system` and no system is selected.

---

### buildSignatureCleanupOptions(settings, connections): SignatureCleanupOptions
Maps panel settings into `signatureCleanupFilters` options.