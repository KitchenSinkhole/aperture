## status.ts

**Purpose:** Derives the user-facing static-data health from the `ap_sde_state` singleton, so the layout banner and the JSON route share one rule.
**File:** `src/lib/sde/status.ts`

---

### SdeStatusState
`'ok' | 'stale' | 'failing'`.

### SdeStatus
`{ state, currentBuild, latestBuild, checkedAt }`. `checkedAt` is ISO-8601 or `null`. Deliberately excludes `failure_reason`, `consecutive_failures`, and the orphan/uncataloged detail — those are operator fields and stay on `/setup`, which reads the row directly.

---

### getSdeStatus(): Promise&lt;SdeStatus&gt;
Reads the singleton row and classifies it.

- **No row** — `stale`. The `universe_*` tables may be fine (bootstrapped before the state row existed), so this is not `failing`.
- **`failing`** — `failed_at` is set *and* the instance is still behind `latest_build`. A failure a later run recovered from does not surface.
- **`stale`** — either clock trips: `behind_since` older than `SDE_STALE_GRACE_HOURS`, or the later of `checked_at`/`refreshed_at` older than `SDE_CHECK_STALE_HOURS` (`null` counts as older for both). The gap clock catches a refresh that ran without closing the gap; the check clock catches a refresh that never reached its build comparison, where `latest_build` never advances and the gap clock is therefore blind. The check clock takes `refreshed_at` into account so a deployment freshly bootstrapped from the pinned build, which has never checked, is not called stale before the first daily cron gets its chance.
- **`ok`** — otherwise.

`failing` takes precedence over `stale`.

**Returns:** The classified status, safe to serialize to any signed-in client.
