## publicSnapshot.ts

**Purpose:** Serving layer for the public share snapshot — a short-TTL, LRU-bounded cache over `loadPublicMapView` plus the rate limiter guarding `/api/public/[token]/snapshot`.
**File:** `src/lib/map/publicSnapshot.ts`

State is a `globalThis` singleton (mirror of `bus.ts` / `clientErrorRate.ts`) so it survives HMR. Nothing here touches Postgres directly.

---

### getPublicSnapshot(token: string, now?: number, load?: (t: string) => Promise<PublicMapViewData | null>): Promise<PublicMapViewData | null>
The redacted snapshot for `token`, served from cache when a live entry exists. The projection is viewer-independent, so one load is handed to every viewer of a token: concurrent misses are coalesced onto a single in-flight promise rather than each opening its own query, and that is what keeps an arbitrarily large anonymous audience off the database.

`null` results (unknown, expired, revoked, soft-deleted parent) are cached alongside hits, so token guessing cannot be turned into a stream of database reads.

Entries are held in a `Map` iterated in insertion order; a hit is re-inserted so the head is the least recently used, and the cache is trimmed to `PUBLIC_SNAPSHOT_CACHE_MAX_ENTRIES` after every load. A rejected load caches nothing and propagates.

**Parameters:**
- `token` — the raw token from the `/live/<token>` URL.
- `now` — test seam; also fixes the entry's expiry so a fixed clock is deterministic.
- `load` — test seam; defaults to `loadPublicMapView`.

**Returns:** the cached or freshly-loaded `PublicMapViewData`, or `null`.

---

### invalidatePublicSnapshot(token: string): void
Drops `token`'s cached snapshot so the next read reloads it.

---

### allowPublicSnapshotRequest(clientKey: string, now?: number): boolean
Whether a snapshot request from `clientKey` (a best-effort client IP) is accepted. Fixed-window counters: when the global window elapses it rolls and the per-IP map is cleared, bounding memory regardless of how many distinct addresses called. Returns `false` — the caller answers 429 — once either `PUBLIC_SNAPSHOT_MAX_PER_IP` or `PUBLIC_SNAPSHOT_MAX_GLOBAL` is exceeded for the window.

---

### __resetPublicSnapshotState(): void
Test seam: clears cache, in-flight map, and rate-limit state.

### Depends on
- `./loadPublicMap` (`loadPublicMapView`, `PublicMapViewData`), `aperture.config` (`PUBLIC_SNAPSHOT_*`).
