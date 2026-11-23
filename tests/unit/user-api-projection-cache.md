## user-api-projection-cache.test.ts

**Purpose:** DB-free unit tests, on an injected clock and loader, for the user API projection cache (`src/lib/userApi/cache.ts`).
**File:** `tests/unit/user-api-projection-cache.test.ts`

### Covers
- `userApiProjectionKey` — map and resource only for `map` / `signatures` / `notes`; `full` or `own:<userId>` appended for `pilots` / `mass_log` by the viewer's Blackout standing.
- `getUserApiProjection` — concurrent misses for one key perform one load; distinct keys load separately; a hit inside the TTL and a reload at it; the success body and `generatedAt`; a weak ETag that follows the payload and not the clock; the hidden mass-log body; a rejected load caching nothing; LRU eviction at the size cap.
- `clearUserApiProjections` — empties the cache, and a load in flight across the clear does not cache its result.
