## client.ts

**Purpose:** Browser-side fetch helpers for the static SDE reference catalogs.
**File:** `src/lib/reference/client.ts`

`'use client'`. Each catalog is immutable for a session, so every helper caches what it has resolved in module-level state.

---

### fetchWormholeJumpInfo(): Promise<FetchResult<WormholeJumpInfoRow[]>>
GETs `/api/reference/wormholes` via the shared `requestJson` core. Memoised, so the Jump Info dialog reopens without a re-fetch. On a non-2xx / network error returns `{ ok: false, error }` (and the shared core toasts).

---

### fetchScanTypes(typeIds: readonly number[]): Promise<ReadonlyMap\<number, ScanTypeInfo\> | null>
POSTs the type ids one D-Scan reported to `/api/reference/scan-types` and resolves each against the SDE. Cached per type id, including the ids the SDE turns out not to carry, so only ids never asked about before cost a request — a repeat scan of the same system usually costs none.

The returned map holds only the ids the SDE carries. **An id the caller asked about and does not find in the map is unknown to this build**, which callers must keep distinct from a known non-ship: a hull newer than the ingested SDE arrives that way, and dropping it would hide a hostile.

Resolves to **null** when the lookup fails (the shared core has already toasted), so callers can show a degraded notice instead of presenting a partial read as a complete scan. A failure caches nothing, so the next paste retries.

---

### Types
- `ScanTypeInfo = { groupId, isShip }`
