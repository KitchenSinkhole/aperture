## abuse.ts

**Purpose:** Persists strikes on user API tokens and applies the abuse ladder: suspend (strikes 1 and 2), then revoke and block the owning account (strike 3).
**File:** `src/lib/userApi/abuse.ts`

Strikes are detected in-process by `rateLimit.ts`. Each transition is exactly one actorless `ap_map_event` (`api.token_suspended` / `api.token_revoked`), whose payload names the token's label and the owning account's main at the time; it never carries the token, its hash or its prefix. The auth cache is invalidated after the transaction commits, so the very next request sees the change. An account block writes no event of its own: it rides the revocation's transaction and is logged at `warn`.

No `import 'server-only'`.

---

### applyUserApiStrike(tokenId: bigint, now?: Date): Promise<UserApiStrikeOutcome | null>
One transaction holding the token and account rows (`FOR UPDATE`): numbers the strike with `nextUserApiStrike`, writes `strike_count` / `last_strike_at`, then
- strikes 1 and 2: sets `suspended_until` and commits `api.token_suspended` (`until` as an ISO string, `strike`);
- strike 3: sets `revoked_at`, `revoked_reason='abuse'`, and blocks the account (`api_blocked_at = now`, `api_blocked_until` from `userApiAccountBlockUntil`, an automatic `api_block_reason` naming the token label), then commits `api.token_revoked` with reason `abuse`. An account already blocked keeps its block untouched and `accountBlocked` is false.

After commit: `invalidateUserApiToken`, plus `invalidateUserApiAccount` when a block was applied; tallies `user_api_strikes_total{level}`; enqueues the webhook dispatch for the event.

**Returns:** the outcome, or null with nothing written for a missing or already-revoked token. Never throws: a failure is logged at `error` and returns null, so the request path can fire it without awaiting.

---

### nextUserApiStrike(token: { strikeCount, lastStrikeAt }, now: Date): number
The next strike's number: `strikeCount + 1`, or 1 when there was no previous strike or it is more than `USER_API_STRIKE_DECAY_DAYS` old.

---

### userApiSuspensionMs(strike: number): number | null
The suspension a strike carries (`USER_API_STRIKE_SUSPENSIONS_MS`), or null when it revokes.

---

### userApiAccountBlockUntil(previousBlockedAt: Date | null, now: Date): Date | null
End of an automatic block starting at `now`: `USER_API_FIRST_BLOCK_DAYS` ahead, or null (indefinite) when the previous block began at most `USER_API_REPEAT_OFFENCE_WINDOW_DAYS` before `now`.

### Depends On
- `@/lib/map/mutations/core` (`commitMapEvent` in joined-transaction mode, `enqueueWebhookDispatch`).
- `./authorize` (`invalidateUserApiToken`, `invalidateUserApiAccount`, `isUserApiAccountBlocked`).
- `@/lib/metrics/registry` (`recordUserApiStrike`), `@/lib/log/logger`.
- Schema: `ap_map_api_token`, `ap_map`, `ap_user`, `ap_character`.
- `aperture.config` (`USER_API_STRIKE_*`, `USER_API_FIRST_BLOCK_DAYS`, `USER_API_REPEAT_OFFENCE_WINDOW_DAYS`).
