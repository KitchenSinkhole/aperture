## client.ts

**Purpose:** Browser-side fetch helpers for the static SDE reference catalogs.
**File:** `src/lib/reference/client.ts`

`'use client'`. Each catalog is immutable for a session, so every helper memoises its first successful response in a module-level cache.

---

### fetchWormholeJumpInfo(): Promise<FetchResult<WormholeJumpInfoRow[]>>
GETs `/api/reference/wormholes` via the shared `requestJson` core. Memoised, so the Jump Info dialog reopens without a re-fetch. On a non-2xx / network error returns `{ ok: false, error }` (and the shared core toasts).

---

### fetchShipTypeGroups(): Promise<ReadonlyMap\<number, number\> | null>
GETs `/api/reference/ship-types` and folds the rows into a ship type id → `universe_group.id` map, for telling ships from the rest of a D-Scan. Memoised, so only the first paste of a session costs a request. Resolves to **null** on failure rather than an error shape (the shared core has already toasted), so callers can degrade instead of treating every scanned object as a hull.
