## rules.ts

**Purpose:** Pure alert rules + the in-memory dedup state machine and Discord-payload formatting for Phase 6 instance alerting.
**File:** `src/lib/alerts/rules.ts`

DB-free by design: rules are pure functions of a gathered `AlertSignals` snapshot, and firing state is a `globalThis` singleton (mirroring [[bus]] / [[breaker]]) — never a table. That is what lets alerting fire about a degraded DB and makes the state machine unit-testable without one. The IO shell lives in [[scheduler]]. No `server-only` import (loaded by `server.ts`).

---

### evaluateRules(signals: AlertSignals): AlertRuleResult[]
Evaluate all five rules against one snapshot, in fixed order `db, worker, esi_breakers, job_abandoned, error_rate`. Pure — no IO, no clock. Per-rule status:
- `db` — `down` if `dbProbeMs === null` (probe failed/timed out); `degraded` if `> ALERT_DB_SLOW_MS`; else `ok`. The headline rule and the reason for the whole DB-independent design.
- `worker` — `unknown` if `workerStaleMs === null` (unreadable, incl. fresh boot before any job finished); `down` if `> HEALTH_WORKER_STALE_MS`; else `ok`.
- `esi_breakers` — `degraded` if `openBreakers >= ALERT_ESI_BREAKERS_OPEN_THRESHOLD`; else `ok`.
- `job_abandoned` — `unknown` if `abandonedJobs === null`; `down` if `> 0`; else `ok`.
- `error_rate` — `unknown` if `recentErrors === null`; `degraded` if `>= ALERT_ERROR_RATE_THRESHOLD` over the window; else `ok`.

---

### reconcile(results: AlertRuleResult[], now = Date.now()): AlertTransition[]
Fold results into the in-memory firing state and emit one `AlertTransition` per actual edge, mirroring the `consecutive_failures` dedup in [[dispatcher]]:
- a bad result (`down`/`degraded`) increments `consecutiveBad` and fires (`kind:'fire'`) only once it reaches `ALERT_DEBOUNCE_EVALUATIONS` — the debounce that honors "open > X min" and swallows single-tick blips;
- an `ok` result while firing emits `kind:'resolve'` and resets the counter;
- `unknown` is a **no-op** (a DB-backed rule during a DB outage must not false-resolve; the `db` rule owns that case).

`now` is injectable for tests. Mutates module state; call before dispatch so a delivery failure can't re-fire.

---

### formatTransition(transition: AlertTransition): { status: DiscordWebhookPayload; operator: DiscordWebhookPayload }
Build the two payloads: a terse, non-technical `content` message for the public `STATUS_WEBHOOK_URL` channel, and a verbose embed (rule, status, relative firing-since, severity color: red `down` / amber `degraded` / green resolve) for the operator `ALERT_WEBHOOK_URL` channel. PII-free by construction — rule keys and counts only.

---

### __resetAlertStateForTest(): void
Clears all firing state between test cases (mirrors `__resetBreakersForTest`).
