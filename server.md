## server.ts

**Purpose:** Custom Node entry point — one process serving the Next.js app and the WebSocket upgrade handler on a shared HTTP server.
**File:** `server.ts`

### Behaviour
- `dev = NODE_ENV !== 'production'`; listens on `PORT` (default 3003) / `HOSTNAME` (default `0.0.0.0`).
- **Calls `loadEnvConfig` (`@next/env`) before any env-reading module is imported.** `tsx` has no dotenv loader, so without this `@/lib/env` would freeze `AUTH_SECRET=''` and the WS server would reject every upgrade with 401. Because static imports are hoisted, `wsServer` and `runner` are imported **dynamically** (inside `app.prepare().then`) so they read the now-loaded vars — using the same loader Next uses, so the cookie-decoding secret matches the app side.
- Prepares the Next app, creates an `http` server delegating to Next's request handler, then `attachWsServer(server)` wires the WS upgrade handler.
- After `server.listen`, boots the embedded graphile-worker via `startWorker()`. A boot failure is logged but does **not** crash the HTTP server — the operator's recourse is to inspect `ap_job_run` and re-run `pnpm worker:once`.
- Then, when `env.ZKB_FEED_ENABLED` (default true), starts the long-lived zKillboard feed via `startZkbFeed()`. It's a single global loop (not a per-entity job), so it lives here beside the worker rather than in graphile-worker.
- Then starts the in-process instance-alerting loop via `startAlertLoop()` ([[scheduler]], Phase 6). No-ops unless `ALERT_WEBHOOK_URL` / `STATUS_WEBHOOK_URL` is set. It runs here — not as a graphile-worker cron — **on purpose**: a DB-backed cron could never fire to alert about a degraded DB, and its in-memory dedup state must not depend on a healthy DB either.
- Installs `SIGTERM` / `SIGINT` handlers that call `stopAlertLoop()`, `stopZkbFeed()`, then `stopWorker()` and close the HTTP server. graphile-worker's own signal handling is disabled (`runner.ts` `noHandleSignals: true`) so the two don't race.
- Lifecycle messages (ready / worker / feed / shutdown) go through the structured logger ([[logger]]) bound to `source='server'`, imported dynamically alongside the other env-reading modules.
- Intentionally thin — all realtime logic lives in `src/lib/realtime/wsServer.ts` / `bus.ts`; all job logic in `src/lib/jobs/`.
- Run via `pnpm dev` (`tsx watch server.ts`) and `pnpm start` (`tsx server.ts`); set `NODE_ENV=production` in the environment for a production run.

### Depends On
- `next`, `node:http`, `@next/env` (`loadEnvConfig`), `@/lib/realtime/wsServer` (`attachWsServer`, dynamically imported), `@/lib/jobs/runner` (`startWorker` / `stopWorker`, dynamically imported), `@/lib/integrations/zkbFeed` (`startZkbFeed` / `stopZkbFeed`, dynamically imported), `@/lib/alerts/scheduler` (`startAlertLoop` / `stopAlertLoop`, dynamically imported), `@/lib/env`.
