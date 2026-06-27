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
- `GITHUB_CHANGELOG_REPO`, `GITHUB_CHANGELOG_REVALIDATE_S` — GitHub releases changelog feed.

**Realtime / WebSocket**
- `MAP_EVENT_NOTIFY_CHANNEL_PREFIX` — `pg_notify` channel prefix for `ap_map_event` fanout.
- `WS_PATH` — WebSocket upgrade path on the same Next.js deployment.
- `WS_HEARTBEAT_MS`, `WS_RECONNECT_BASE_MS`, `WS_RECONNECT_MAX_MS`, `WS_HEALTH_STALE_MS` — heartbeat, client reconnect backoff, and the staleness threshold that flips the degraded-mode banner.

**Map limits & display**
- `ROUTE_HUBS` — trade hubs the route module reports jump distance to (EVE system IDs).
- `MAX_MAPS_PER_SCOPE` — per-scope ceilings for `ap_map.scope`.
- `MAX_SYSTEMS_PER_MAP` — applied where `ap_map_system.visible = true`.

**Authz / character cleanup**
- `CHARACTER_CLEANUP_CRON`, `CHARACTER_AUTHZ_RESYNC_STALE_AFTER_MS`, `CHARACTER_AUTHZ_RESYNC_BATCH_SIZE` — cadence and throttle for the `character-cleanup` job's kick-expiry + authz resync passes.
- `HEALTH_WORKER_STALE_MS` — `/api/health/ready` flags the `worker` component unhealthy if no `ap_job_run` finished within this window (15 min ≈ 3 `character-cleanup` ticks).
- `AUTHZ_ADMIN_ROLE` — the ESI corporation role (`Director`) that resolves a character to `manager`.

**Wormhole / signature lifetimes**
- `WORMHOLE_EOL_LIFETIME_MS` (4h + 15m buffer), `WORMHOLE_EOL_CRITICAL_LIFETIME_MS` (1h + 15m), `WORMHOLE_DEFAULT_LIFETIME_MS` (48h) — drive the canvas countdowns and the reap-job purge thresholds.
- `SIGNATURE_DEFAULT_TTL_MS` — default `expires_at` offset for new signatures (5 days).

**Job runtime / instrumentation**
- `JOB_WORKER_CONCURRENCY`, `JOB_POLL_INTERVAL_MS` — graphile-worker concurrency and fallback poll cadence (LISTEN/NOTIFY drives the fast path).
- `JOB_INSTRUMENTATION_ERROR_MAX_LENGTH`, `JOB_INSTRUMENTATION_NOTES_MAX_BYTES` — caps for `ap_job_run.error_text` / `notes`.
- `MAP_PURGE_GRACE_DAYS` — grace window before hard-purging soft-deleted maps at downtime.
- `JOB_DELETE_BATCH_SIZE` — per-run cap for row-by-row cleanup jobs (bounds the pg_notify burst at downtime).

Per-task cron expressions live as `cron` strings on each task module in `src/lib/jobs/tasks/`, not here.

### ApertureConfig
Inferred type alias for `typeof apertureConfig` so consumers can type a parameter without importing the runtime value.
