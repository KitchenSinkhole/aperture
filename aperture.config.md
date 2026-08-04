## aperture.config.ts

**Purpose:** Single source of truth for hard-coded app constants that must not be runtime config (job cadences, breaker thresholds, wormhole lifetimes, channel/path names, map ceilings). Nothing here is read from `process.env`.
**File:** `aperture.config.ts`

---

### apertureConfig
A frozen `as const` object exposed as a named export. Grouped by concern:

**Location polling**
- `LOCATION_POLL_ONLINE_MS` / `LOCATION_POLL_OFFLINE_MS` — server-side location-poll cadence by character online state.

**ESI / SSO**
- `JWK_REFETCH_MIN_INTERVAL_MS` — minimum interval between JWK-set refetches.
- `CCP_SSO_DOWNTIME`, `CCP_SSO_DOWNTIME_WINDOW_MIN`, `CCP_SSO_DOWNTIME_BUFFER_MIN` — daily ESI downtime window (calls expected to fail).
- `ESI_BREAKER_FAILURE_THRESHOLD`, `ESI_BREAKER_COOLDOWN_MS`, `ESI_REQUEST_TIMEOUT_MS` — per-operationId circuit breaker tuning + request timeout.
- `ESI_DATASOURCE` — `tranquility` (live) vs `singularity` (test).
- `ESI_COMPATIBILITY_DATE` — `X-Compatibility-Date` header sent on every ESI request; pins the unversioned ESI surface to the date `openapi.json` was generated for (omitting it makes CCP default to `2020-01-01`). Bump together with the checked-in spec.
- `SSO_AUTHORIZE_PATH` / `SSO_TOKEN_PATH` / `SSO_JWKS_PATH` — EVE SSO endpoint paths joined onto `env.AUTH_EVE_SSO_BASE`.
- `SSO_EXPECTED_ISSUER` — accepted `iss` claim values (bare host + scheme-prefixed form).
- `SSO_TOKEN_REFRESH_BUFFER_S` — refresh the access token this many seconds before expiry.
- `LOGIN_REGATE_INTERVAL_S` — how often the `jwt` callback re-checks login eligibility for an already-issued session (reads cached corp/alliance from `ap_character`, no ESI); on denial the session is invalidated. Bounds how long a pilot who left the owning corp/alliance keeps app access on a restricted deployment.
- `ESI_SCOPES` — default scope list requested at login.

**Third-party integrations (read-side)**
- `INTEGRATION_REQUEST_TIMEOUT_MS`, `INTEGRATION_USER_AGENT` — shared timeout + UA for zKillboard / EVE-Scout / GitHub.
- `ZKB_R2Z2_BASE`, `ZKB_FEED_POLL_MS` (≥6s hard floor), `ZKB_FEED_INDEX_REFRESH_MS`, `ZKB_FEED_MAX_CATCHUP` — zKillboard R2Z2 live-feed config.
- `ZKB_FEED_MAX_KILL_AGE_MS` (10 min) — max age from ESI `killmail_time` a feed kill may have and still flash; older (or undatable) kills are dropped so reprocessed / late-submitted killmails zKB appends to the live sequence don't trigger a phantom underglow.
- `GITHUB_CHANGELOG_REPO`, `GITHUB_CHANGELOG_REVALIDATE_S` — GitHub releases changelog feed.
- `KILLMAIL_CACHE_RETENTION_DAYS` (30), `KILLMAIL_CLEANUP_CRON` — retention window and daily sweep cadence for the `universe_killmail` cache reaper (`killmail-cleanup`).

**Realtime / WebSocket**
- `APP_UPDATE_IDLE_RELOAD_MS` — how long a tab must stay continuously hidden, with a newer build deployed, before it reloads itself in the background. A visible tab is never reloaded from under the pilot; it gets a banner instead.
- `MAP_EVENT_NOTIFY_CHANNEL_PREFIX` — `pg_notify` channel prefix for `ap_map_event` fanout.
- `WS_PATH` — WebSocket upgrade path on the same Next.js deployment.
- `WS_HEARTBEAT_MS`, `WS_RECONNECT_BASE_MS`, `WS_RECONNECT_MAX_MS`, `WS_HEALTH_STALE_MS` — heartbeat, client reconnect backoff, and the staleness threshold that flips the degraded-mode banner.
- `PRESENCE_SESSION_GAP_MS` — reconnect window within which `ap_character_presence` adopts the still-open session instead of opening a second one. `PRESENCE_LIVE_GRACE_MS` (2x `WS_HEARTBEAT_MS`) — how fresh `ended_at` must be for a session to read as live. `PRESENCE_RETENTION_DAYS` — prune horizon for the presence table.

**Map limits & display**
- `ROUTE_HUBS` — trade hubs the route module reports jump distance to (EVE system IDs).
- `MAX_MAPS_PER_SCOPE` — per-scope ceilings for `ap_map.scope`.
- `MAX_SYSTEMS_PER_MAP` — applied where `ap_map_system.visible = true`.

**Public map share**
- `PUBLIC_SNAPSHOT_CACHE_TTL_MS`, `PUBLIC_SNAPSHOT_CACHE_MAX_ENTRIES` — lifetime and LRU size of the viewer-independent share-snapshot cache.
- `PUBLIC_SNAPSHOT_RATE_WINDOW_MS`, `PUBLIC_SNAPSHOT_MAX_PER_IP`, `PUBLIC_SNAPSHOT_MAX_GLOBAL` — fixed-window rate limits on `/api/public/[token]/snapshot`.
- `PUBLIC_LINKS.repo`, `PUBLIC_LINKS.discord` — the source and Discord invite links the spectator view's promo bar offers.
- `WS_PUBLIC_PATH` — WebSocket upgrade path for token-authed public spectator sockets, separate from `WS_PATH`.
- `PUBLIC_WS_MAX_PER_TOKEN` — live public sockets one share token may hold before further upgrades 503.
- `PUBLIC_WS_UPGRADE_WINDOW_MS`, `PUBLIC_WS_MAX_UPGRADES_PER_IP`, `PUBLIC_WS_MAX_UPGRADES_GLOBAL` — fixed-window rate limits on the public WS upgrade handler.
- `PUBLIC_WS_NUDGE_MIN_INTERVAL_MS` — minimum spacing between `publicUpdate` nudges sent to one public socket.
- `PUBLIC_REFETCH_JITTER_MS`, `PUBLIC_POLL_INTERVAL_MS`, `PUBLIC_IDLE_REFRESH_MS` — spectator client refetch jitter, socket-down poll cadence, and the idle-map refetch backstop.

**Authz / character cleanup**
- `CHARACTER_CLEANUP_CRON`, `CHARACTER_AUTHZ_RESYNC_STALE_AFTER_MS`, `CHARACTER_AUTHZ_RESYNC_BATCH_SIZE` — cadence and throttle for the `character-cleanup` job's kick-expiry + authz resync passes.
- `HEALTH_WORKER_STALE_MS` — `/api/health/ready` flags the `worker` component unhealthy if no `ap_job_run` finished within this window (15 min ≈ 3 `character-cleanup` ticks).
- `AUTHZ_ADMIN_ROLE` — the ESI corporation role (`Director`) that resolves a character to `manager`.

**Wormhole / signature lifetimes**
- `WORMHOLE_EOL_NOMINAL_MS` (4h), `WORMHOLE_EOL_CRITICAL_NOMINAL_MS` (1h) — in-game nominal EOL lifetimes; drive the displayed canvas countdown.
- `WORMHOLE_EOL_LIFETIME_MS` (4h + 15% / 36m buffer), `WORMHOLE_EOL_CRITICAL_LIFETIME_MS` (1h + 15m) — nominal + grace-buffer reap-job purge thresholds. `WORMHOLE_DEFAULT_LIFETIME_MS` (48h) covers the non-EOL default.
- `WORMHOLE_EXPIRED_LIFETIME_MS` (4h) — reap threshold for a manually-marked `expired` wormhole, measured from `eol_at`; safely longer than the worst-case post-"imminent" in-game lifetime.
- `SIGNATURE_DEFAULT_TTL_MS` — default `expires_at` offset for new signatures (48 hours).

**Job runtime / instrumentation**
- `JOB_WORKER_CONCURRENCY`, `JOB_POLL_INTERVAL_MS` — graphile-worker concurrency and fallback poll cadence (LISTEN/NOTIFY drives the fast path).
- `JOB_INSTRUMENTATION_ERROR_MAX_LENGTH`, `JOB_INSTRUMENTATION_NOTES_MAX_BYTES` — caps for `ap_job_run.error_text` / `notes`.
- `MAP_PURGE_GRACE_DAYS` — grace window before hard-purging soft-deleted maps at downtime.
- `JOB_DELETE_BATCH_SIZE` — per-run cap for row-by-row cleanup jobs (bounds the pg_notify burst at downtime).

**Observability / metrics**
- `METRICS_ESI_LATENCY_BUCKETS_MS`, `METRICS_ROUTE_LATENCY_BUCKETS_MS`, `METRICS_HTTP_LATENCY_BUCKETS_MS`, `METRICS_JOB_DURATION_BUCKETS_MS`, `METRICS_FANOUT_LATENCY_BUCKETS_MS` — histogram bucket upper-bounds (`le`) for the `esi_request_duration_ms` / `route_plan_duration_ms` / `http_request_duration_ms` / `job_duration_ms` / `realtime_fanout_duration_ms` histograms.
- `METRICS_SNAPSHOT_CRON` — cadence for the `metrics-snapshot` job that samples the registry + gauges into `ap_metric_snapshot` (1 min; the admin metrics page buckets it per range).

**Instance alerting (Phase 6)** — consumed by the in-process alert loop (`src/lib/alerts/`), booted from `server.ts` rather than graphile-worker so scheduling/state survive a degraded DB.
- `ALERT_EVALUATE_INTERVAL_MS` — alert-loop `setInterval` cadence (1 min).
- `ALERT_DB_PROBE_TIMEOUT_MS`, `ALERT_DB_SLOW_MS` — `SELECT 1` probe timeout (→ `down`) and the slow-but-succeeded threshold (→ `degraded`).
- `ALERT_DEBOUNCE_EVALUATIONS` — consecutive bad ticks before a rule fires; the debounce that honors "open > X min" and swallows single-tick blips.
- `ALERT_ESI_BREAKERS_OPEN_THRESHOLD` — open-breaker count at/above which the `esi_breakers` rule goes bad.
- `ALERT_JOB_ABANDONED_MS` — age past which an un-ended `ap_job_run` row counts as an abandoned (worker-died) handler.
- `ALERT_ERROR_RATE_WINDOW_MS`, `ALERT_ERROR_RATE_THRESHOLD` — lookback window and error|fatal `ap_error_log` count that trips the `error_rate` rule. Worker staleness reuses `HEALTH_WORKER_STALE_MS`.

**Client error capture (Phase 7)** — consumed by the `/api/client-errors` ingest route + its in-process limiter (`src/lib/log/clientErrorRate.ts`).
- `CLIENT_ERROR_RATE_WINDOW_MS` — fixed-window length for the ingest rate limiter; per-session and global counters reset each window.
- `CLIENT_ERROR_MAX_PER_SESSION`, `CLIENT_ERROR_MAX_GLOBAL` — per-session and global caps; exceeding either drops the report (429) without writing, so a browser render loop can't flood `ap_error_log`.
- `CLIENT_ERROR_MESSAGE_MAX_LENGTH`, `CLIENT_ERROR_STACK_MAX_LENGTH` — truncation caps on the ingested `message` and `stack`/`componentStack` before persistence.

**Integrations API**
- `INTEGRATION_MAX_CHARACTER_IDS` — max `characterIds` a single `/api/integrations/activity-stats` request may bound its result to (400 on overflow).
- `INTEGRATION_PRESENCE_DEFAULT_WINDOW_DAYS` (90) — `/api/integrations/presence-sessions` window when `from` is omitted, counted back from `to`. `INTEGRATION_PRESENCE_MAX_WINDOW_DAYS` (366) — widest `[from, to]` span accepted (400 on overflow).

**SDE self-refresh**
- `SDE_REFRESH_MAX_SHRINK_PCT` (5) — acceptance gate on an SDE ingest (`src/lib/sde/ingest.ts`): a gated `universe_*` table whose new-build row count drops more than this percent below the live count fails the run before any write. Tables seeded from the hand-maintained catalog CSVs are exempt (their re-binding check is a hard failure on any miss, stricter than a shrink threshold).
- `SDE_STALE_GRACE_HOURS` (2) — how long `ap_sde_state.behind_since` may stand before `getSdeStatus` (`src/lib/sde/status.ts`) reports `stale`.
- `SDE_CHECK_STALE_HOURS` (36) — how long `ap_sde_state.checked_at` may go without advancing before `getSdeStatus` reports `stale`. Sized above the `sde-refresh` cron period so one ordinary day between checks is not an incident; it is the only signal covering a refresh that never reached its build comparison.

Per-task cron expressions live as `cron` strings on each task module in `src/lib/jobs/tasks/`, not here.

### ApertureConfig
Inferred type alias for `typeof apertureConfig` so consumers can type a parameter without importing the runtime value.
