## instance.ts

**Purpose:** The operator's kill switch for the whole `/api/v1/*` user API (`ap_instance.user_api_enabled`), read through a short in-process cache.
**File:** `src/lib/userApi/instance.ts`

The value is cached for `USER_API_AUTH_CACHE_TTL_MS`; concurrent misses share one read. A deployment with no `ap_instance` row reads as on (the column default). State is a `globalThis` singleton.

No `import 'server-only'`.

---

### isUserApiInstanceEnabled(now?: number): Promise<boolean>
Whether the user API is on. **Parameters:** `now` — test seam (epoch ms) for the cache expiry.

---

### invalidateUserApiInstanceSwitch(): void
Drops the cached value, and stops any read in flight from caching its result, so the next call reads the row. Call after the toggle commits.

### Depends On
- `@/db/client`; schema `ap_instance`; `aperture.config` (`USER_API_AUTH_CACHE_TTL_MS`).
