## scheduler.ts

**Purpose:** The IO shell for Phase 6 instance alerting — an in-process evaluation loop that gathers signals, runs the rules ([[rules]]), and pushes transitions to Discord.
**File:** `src/lib/alerts/scheduler.ts`

Booted from `server.ts` as a `setInterval`, **not** a graphile-worker cron, so scheduling and the in-memory dedup state survive a degraded DB — the very thing alerting must report on. Delivery is HTTP-only ([[discord]] `postDiscordWebhook`), so it needs no DB. No `server-only` import (loaded under `tsx`).

---

### startAlertLoop(): void
Start the loop at `ALERT_EVALUATE_INTERVAL_MS`. No-ops if already running or if neither `ALERT_WEBHOOK_URL` nor `STATUS_WEBHOOK_URL` is configured. The timer is `unref`'d so it never keeps the process alive on its own.

### stopAlertLoop(): void
Clear the interval. Idempotent. Called from the `server.ts` shutdown handler.

### isAlertLoopRunning(): boolean
Whether the interval timer is currently installed.

---

### Behaviour
- **Tick** (`tick`, internal): re-entrancy-guarded (skips if the prior tick is still running); never throws (logged via [[logger]] `source='server'`). Gathers signals → `reconcile(evaluateRules(signals))` → dispatches each transition. State is mutated by `reconcile` **before** dispatch, so a delivery failure does not re-fire next tick.
- **gatherSignals**: each DB-backed source (`SELECT 1` probe latency, worker staleness via `latestFinishedRun`, abandoned-job count over `ALERT_JOB_ABANDONED_MS`, recent error|fatal `ap_error_log` count over `ALERT_ERROR_RATE_WINDOW_MS`) is independently `withTimeout`-guarded at `ALERT_DB_PROBE_TIMEOUT_MS`; failure → field stays `null` (rule → `unknown`). `openBreakerCount()` is in-process and always available. Reuses the [[queries]] / [[breaker]] primitives, **not** `deepHealth()` (which isn't timeout-guarded and could wedge on a hung DB).
- **dispatch**: posts to whichever of the two webhooks is set; logs (best-effort) any non-ok delivery. `postDiscordWebhook` never throws.

### Depends On
- `@/db/client` (`pool`, `db`), `@/db/schema` (`apJobRun`, `apErrorLog`), `@/lib/esi/breaker` (`openBreakerCount`), `@/lib/jobs/queries` (`latestFinishedRun`), `@/lib/integrations/discord` (`postDiscordWebhook`), `@/lib/log/logger` (`getLogger`), `@/lib/env`, `./rules`, `aperture.config.ts`.
