## logger.ts

**Purpose:** Structured logging for Aperture — a thin pino wrapper that emits JSON to stdout and persists `error`/`fatal` logs to `ap_error_log`.
**File:** `src/lib/log/logger.ts`

---

### logger
The default `Logger` bound to `source='server'`. Import this in request/action/route code: `logger.info('…', { mapId })`.

### getLogger(source: ErrorSource): Logger
Returns a `Logger` bound to a specific `error_source` (`'server' | 'job' | 'client'`). Background-job code uses `getLogger('job')` so its persisted rows are attributed correctly.

### Logger (interface)
`debug | info | warn | error | fatal`, each `(message: string, context?: Record<string, unknown>) => void`. `context` is passed to pino as the merging object and (for `error`/`fatal`) scrubbed + persisted.

### Behaviour & Notes
- **No `transport` option** — pino writes one JSON line per log to stdout (fd 1). Worker-thread transports are avoided (they break under bare `tsx` + the Next bundler). `pino` is in `serverExternalPackages` (next.config) so its internal requires aren't mangled.
- **No `import 'server-only'`** — runner-reachable (same precedent as `rights.ts` / `bus.ts`).
- pino singleton on `globalThis.__apertureLogger` across HMR (mirrors `bus.ts` / metrics registry). Level is `info`, or `silent` under `NODE_ENV='test'`.
- `error`/`fatal` additionally **best-effort persist** a row to `ap_error_log` via `db.insert` — `occurred_at=now`, the level, the bound `source`, the message, `character_id` extracted from `context.characterId` (bigint/number/digit-string, else NULL), and `context` run through [[scrub]] (`scrubContext`). On a successful insert it increments `error_log_events_total{source}`. The insert is wrapped in try/catch and swallowed: logging must never throw, and the DB may be the thing that's down.
- `warn`/`info`/`debug` go to stdout only — no DB write (keeps `ap_error_log` high-signal for Phase 6 alerting).

### Depends On
- `pino`
- `scrubContext` ([[scrub]]) — PII scrub before persistence
- `db` (`@/db/client`), `apErrorLog` (`@/db/schema`)
- `metrics` + `ERROR_LOG_EVENTS_TOTAL` (`@/lib/metrics/registry`)
- `ErrorSource` (`@/types`)
