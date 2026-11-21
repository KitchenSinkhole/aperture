## rateLimit.ts

**Purpose:** In-process request limits of the `/api/v1/*` user API: the per-IP gate and failed-auth IP block (pipeline step 2), the per-token, per-account and global caps (step 6), and the hot-window tracking that detects a strike.
**File:** `src/lib/userApi/rateLimit.ts`

Every counter shares one fixed window, aligned to multiples of `USER_API_RATE_WINDOW_MS`. When it rolls, every per-key counter map is cleared, so memory is bounded regardless of how many keys were seen. Hot-window history is pruned on each roll to `USER_API_STRIKE_SPAN_MS`; an IP block is forgotten once the longest `USER_API_IP_BLOCK_STEPS_MS` step has passed since it ended. Nothing is persisted, so no IP reaches the database. State is a `globalThis` singleton; every export takes an injectable `now` (epoch ms).

Detecting a strike is this module's job; persisting it is `abuse.ts`'s. The caller passes a `strike: true` on to `applyUserApiStrike`.

No `import 'server-only'`.

---

### checkUserApiIp(ip: string, now?: number): UserApiIpGateDecision
Step 2. Refused while `ip` serves a failed-auth block (`retryAfterSec` until the block ends), or once it has made `USER_API_MAX_PER_IP` requests this window (`retryAfterSec` until the window rolls). An accepted request counts against the IP; a refused one does not.

---

### recordUserApiAuthFailure(ip: string, now?: number): boolean
Counts one failed auth from `ip`. The failure past `USER_API_MAX_AUTH_FAILURES_PER_IP` in one window blocks the IP for one `USER_API_IP_BLOCK_STEPS_MS` step: the first, or one up from the IP's previous block while that is still remembered, capped at the last. **Returns:** true when this failure started a block.

---

### consumeUserApiRequest(tokenId: bigint, userId: number, now?: number): UserApiRateDecision
Step 6: the token cap (`USER_API_MAX_PER_TOKEN`), then the account cap summed over the account's tokens (`USER_API_MAX_PER_ACCOUNT`), then the global ceiling (`USER_API_MAX_GLOBAL`). An accepted request counts against all three; a refused one against none. `limit` and `remaining` describe one budget: on a refusal the cap that refused, on an allow whichever of the three has the fewest requests left (the token's on a tie); `resetSec` and `retryAfterSec` are the time until the window rolls.

Token- and account-cap refusals count towards the token's hot windows; global-ceiling refusals do not. A window is hot on its `USER_API_HOT_WINDOW_REJECTS`th refusal; the hot window that brings the token to `USER_API_STRIKE_HOT_WINDOWS` within `USER_API_STRIKE_SPAN_MS` sets `strike: true` on that one refusal and restarts the token's history.

---

### noteUserApiSuspendedRequest(tokenId: bigint, now?: number): boolean
Counts one request sent on a suspended token towards its hot windows, as above. **Returns:** true when it completes a strike.

---

### __resetUserApiRateLimit(): void
Test seam: clears every counter, hot window and IP block.

### __userApiRateLimitSizes(now?: number): Record<string, number>
Test seam: rolls the window to `now`, then reports the size of every in-process map.

### Depends On
- `aperture.config` (`USER_API_RATE_WINDOW_MS`, `USER_API_MAX_*`, `USER_API_IP_BLOCK_STEPS_MS`, `USER_API_HOT_WINDOW_REJECTS`, `USER_API_STRIKE_HOT_WINDOWS`, `USER_API_STRIKE_SPAN_MS`).
- Types: `UserApiIpGateDecision`, `UserApiRateDecision`.
