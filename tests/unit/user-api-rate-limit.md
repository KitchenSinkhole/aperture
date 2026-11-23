## user-api-rate-limit.test.ts

**Purpose:** DB-free unit tests, on an injected clock, for the user API limiter, the strike arithmetic and the usage buffer (`src/lib/userApi/rateLimit.ts`, `abuse.ts`, `usage.ts`).
**File:** `tests/unit/user-api-rate-limit.test.ts`

`@/db/client` is mocked; its `execute` spy captures the usage `UPDATE`.

### Covers
- `checkUserApiIp` — the per-IP cap, `retryAfterSec` to the window's end, reset on roll.
- `recordUserApiAuthFailure` — the block on the failure past the cap, escalation through every step and the cap at the last, forgetting the step after the block memory, per-window counting.
- `consumeUserApiRequest` — token cap with `remaining` / `resetSec`, the account cap summed over tokens, `limit` and `remaining` reporting the account budget once it is the smaller and on an account-cap refusal, the global ceiling with its own `limit`, refused requests not consuming budget.
- Hot windows — a strike on the third hot window in the span, fired once and on the completing refusal, a short window not counting, windows aging out of the span, history restarting after a strike, account-cap refusals counting and global ones not, suspended requests counting.
- Memory — every in-process map is empty once its window, the strike span or the block memory has rolled.
- `nextUserApiStrike` (decay boundary), `userApiSuspensionMs`, `userApiAccountBlockUntil` (repeat-window boundary).
- Usage — one batched update with summed counts and the latest use, an empty buffer writing nothing, at most one flush per interval, a failed write not throwing.
