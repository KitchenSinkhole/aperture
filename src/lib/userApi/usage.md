## usage.ts

**Purpose:** Batched usage accounting for user API tokens (`ap_map_api_token.last_used_at`, `request_count`).
**File:** `src/lib/userApi/usage.ts`

Requests are tallied in-process and written in one `UPDATE` at most once per `USER_API_USAGE_FLUSH_MS`, on an unref'd timer armed by the first tally after a flush. The figures are approximate: a restart loses at most one interval and a failed write drops its batch. Usage never enters `ap_map_event`. State is a `globalThis` singleton.

No `import 'server-only'`.

---

### recordUserApiUsage(tokenId: bigint, now?: number): void
Tallies one request on `tokenId` at `now` (epoch ms) and arms the next flush.

---

### flushUserApiUsage(): Promise<number>
Writes every pending tally in one `UPDATE` (adds each count to `request_count`, moves `last_used_at` forward and never back) and empties the buffer. A failed write is logged at `warn`. Never throws. **Returns:** the number of tokens in the batch.

---

### __pendingUserApiUsage(): number
Test seam: tokens with a pending tally.

### __resetUserApiUsage(): void
Test seam: drops every pending tally and the armed flush.

### Depends On
- `@/db/client`, `@/lib/log/logger`, `aperture.config` (`USER_API_USAGE_FLUSH_MS`).
