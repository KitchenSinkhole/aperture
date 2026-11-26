## signatureTableSort.ts

**Purpose:** Default sort order for the experimental signatures table.
**File:** `src/lib/map/signatureTableSort.ts`

---

### isSignatureFullyScanned(s)
Whether a sig has group, type, and (for wormholes) leads-to filled.

### compareSignaturesExperimental(a, b)
Sorts unscanned rows before scanned, then by scanner group catalog order, then by `sigId`.
