## cache.ts

**Purpose:** Serving cache for the user API's read projections: short-TTL, LRU-bounded, with concurrent misses coalesced onto one in-flight load.
**File:** `src/lib/userApi/cache.ts`

Entries live for `USER_API_PROJECTION_TTL_MS` and the cache is trimmed to `USER_API_PROJECTION_CACHE_MAX_ENTRIES` after every load, least recently used first (a hit is re-inserted at the tail). State is a `globalThis` singleton so it survives HMR.

---

### getUserApiProjection<R extends UserApiResource>(mapId: bigint, resource: R, viewer: BlackoutViewer, now?: number, load?: UserApiProjectionLoader): Promise<UserApiProjectionEntry<R>>
One resource of one map, from cache while a live entry exists, else from `load` (default `loadUserApiProjection`). Concurrent misses for one key share one load. A rejected load caches nothing and propagates.

The entry holds the `payload`, `generatedAt` (ISO of `now` at load), `body` (the serialised success envelope `{ ok: true, data, hidden?, generatedAt }`), and `etag`, a weak ETag over the payload alone, so a reload whose data is unchanged keeps its ETag.

**Parameters:**
- `viewer` — the token owner's `BlackoutViewer`; part of the key for `pilots` and `mass_log` only.
- `now` — test seam; fixes the entry's expiry and `generatedAt`.
- `load` — test seam (`UserApiProjectionLoader`: `(mapId, resource, viewer) => Promise<UserApiPayload>`).

---

### userApiProjectionKey(mapId: bigint, resource: UserApiResource, viewer: BlackoutViewer): string
`<mapId>:<resource>` for `map`, `signatures` and `notes`. `pilots` and `mass_log` append the visibility: `full`, or `own:<userId>` while `isBlackedOut(viewer)`.

---

### clearUserApiProjections(): void
Drops every cached projection and the in-flight map, and stops any load already in flight from caching its result, so nothing read before the call is served after it. Called by the Blackout on and off actions.

---

### __userApiProjectionCacheSize(): number
Test seam: the number of cached entries.

---

### Depends On
- `./projection` (`loadUserApiProjection`), `@/lib/auth/blackout` (`isBlackedOut`), `node:crypto` (the ETag digest).
- `aperture.config` (`USER_API_PROJECTION_TTL_MS`, `USER_API_PROJECTION_CACHE_MAX_ENTRIES`).
- Types: `UserApiResource`, `UserApiPayload`, `UserApiProjectionEntry`, `BlackoutViewer`.
