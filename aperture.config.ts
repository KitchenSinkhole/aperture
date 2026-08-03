import { version } from './package.json';

/**
 * Typed app-level constants — the knobs that must be hard-coded rather than
 * runtime config. Nothing here is read from the environment.
 */
export const apertureConfig = {
  /** Server-side location-polling cadence while a character is online. */
  LOCATION_POLL_ONLINE_MS: 5_000,

  /** Polling cadence while a character is offline. */
  LOCATION_POLL_OFFLINE_MS: 60_000,

  /** Minimum interval between two JWK-set refetches (rate-limits refetch-on-failure). */
  JWK_REFETCH_MIN_INTERVAL_MS: 10_000,

  /** CCP daily downtime start, UTC `HH:MM`. ESI calls are expected to fail in this window. */
  CCP_SSO_DOWNTIME: '11:00',

  /** Minutes around CCP_SSO_DOWNTIME (11:00 UTC) treated as expected ESI outage. */
  CCP_SSO_DOWNTIME_WINDOW_MIN: 8,

  /** Extra minutes padded onto each side of the downtime window. */
  CCP_SSO_DOWNTIME_BUFFER_MIN: 1,

  /** Consecutive ESI failures (per operationId) that trip a circuit breaker open. */
  ESI_BREAKER_FAILURE_THRESHOLD: 5,

  /** How long an open ESI breaker waits before allowing a half-open trial request. */
  ESI_BREAKER_COOLDOWN_MS: 60_000,

  /** Per-request ESI timeout. */
  ESI_REQUEST_TIMEOUT_MS: 5_000,

  /** Per-request timeout for read-side third-party integrations (zKillboard, EVE-Scout, GitHub). */
  INTEGRATION_REQUEST_TIMEOUT_MS: 5_000,

  /** `User-Agent` sent on read-side third-party integration requests. zKillboard rejects a blank UA with 403. */
  INTEGRATION_USER_AGENT: `Aperture/${version}`,

  /**
   * zKillboard R2Z2 ephemeral feed base. `GET <base>/sequence.json` →
   * `{ sequence }`; `GET <base>/<seq>.json` → one killmail (ESI body + `zkb`
   * block) or 404 when not yet published.
   */
  ZKB_R2Z2_BASE: 'https://r2z2.zkillboard.com/ephemeral',

  /**
   * Delay between zKB feed poll ticks. R2Z2 mandates a ≥6s wait between sequence
   * sweeps; going faster risks an IP block. Hard floor, not a runtime knob.
   */
  ZKB_FEED_POLL_MS: 6_000,

  /** How often the feed rebuilds its in-memory `solarSystemId → mapIds` index from active maps. */
  ZKB_FEED_INDEX_REFRESH_MS: 30_000,

  /**
   * Max sequence files the feed pulls in one tick. Bounds a burst (and the
   * per-tick request budget against the 20 req/s R2Z2 limit); a deeper backlog
   * is skipped — the feed is live-only and does not backfill.
   */
  ZKB_FEED_MAX_CATCHUP: 200,

  /**
   * Max age (from the ESI `killmail_time`) a feed kill may have and still flash.
   * zKB appends reprocessed / late-submitted killmails to the live R2Z2 sequence,
   * so a healthy forward walk can hand us a months-old kill; anything older than
   * this is dropped before it can fan out. Wide enough to cover feed + processing
   * latency, far below the age of a reprocessed kill.
   */
  ZKB_FEED_MAX_KILL_AGE_MS: 600_000,

  /**
   * Retention for the `universe_killmail` cache, in days. Killmail relevance
   * decays and zKillboard only surfaces recent kills, so the `killmail-cleanup`
   * reaper deletes rows whose `killmail_time` is older than this.
   */
  KILLMAIL_CACHE_RETENTION_DAYS: 30,

  /**
   * `killmail-cleanup` cron cadence. Age-by-kill-time retention is not
   * time-critical, so a daily sweep well outside the 11:00 EVE downtime window
   * suffices.
   */
  KILLMAIL_CLEANUP_CRON: '20 4 * * *',

  /** Repository slug used by the changelog integration. Must match the `origin` remote. */
  GITHUB_CHANGELOG_REPO: 'KitchenSinkhole/aperture',

  /**
   * Server-side cache lifetime for the GitHub releases fetch, in seconds (Next
   * `revalidate` unit). Releases change rarely; caching shields the shared,
   * unauthenticated GitHub API quota from a per-client request fan-out.
   */
  GITHUB_CHANGELOG_REVALIDATE_S: 3_600,

  /** ESI `datasource` query param. `tranquility` (live) vs `singularity` (test server). */
  ESI_DATASOURCE: 'tranquility',

  /**
   * ESI compatibility date, sent as the `X-Compatibility-Date` header on every
   * request. The new (unversioned) ESI serves a different API surface per
   * compatibility date; omitting the header makes CCP default to `2020-01-01`,
   * which no longer matches the routes/decoders. Must equal the date the
   * checked-in `src/lib/esi/openapi.json` was generated for — bump both together.
   */
  ESI_COMPATIBILITY_DATE: '2026-06-09',

  /** `pg_notify` channel prefix for `ap_map_event` fanout. */
  MAP_EVENT_NOTIFY_CHANNEL_PREFIX: 'map:',

  /** Path the WebSocket upgrade handler listens on (same Next.js deployment). */
  WS_PATH: '/ws/map/update',

  /** Server→client ping cadence; sockets that miss the next pong are terminated. */
  WS_HEARTBEAT_MS: 30_000,

  /** First client reconnect delay after a dropped socket; backs off exponentially. */
  WS_RECONNECT_BASE_MS: 1_000,

  /** Ceiling for the client reconnect backoff. */
  WS_RECONNECT_MAX_MS: 30_000,

  /** No realtime traffic (incl. heartbeat) for this long flips the degraded-mode banner. */
  WS_HEALTH_STALE_MS: 45_000,

  /**
   * A presence-session reconnect within this window of the prior session's
   * `ended_at` adopts the still-open row instead of opening a second one, so
   * per-character presence intervals never overlap and need no interval
   * merging on read.
   */
  PRESENCE_SESSION_GAP_MS: 300_000,

  /**
   * A presence session is "live" while `ended_at` is newer than this — 2x
   * `WS_HEARTBEAT_MS`, tolerating one missed heartbeat tick before a session
   * reads as ended.
   */
  PRESENCE_LIVE_GRACE_MS: 60_000,

  /** `ap_character_presence` prune horizon, in days. */
  PRESENCE_RETENTION_DAYS: 400,

  /**
   * Major trade hubs the read-only route module reports gate-jump distance to.
   * EVE solar-system IDs. Ordered for display.
   *
   * `proximityJumps` is the high-sec-only gate-jump radius within which an HS
   * system earns a trade-hub proximity badge on the map. It is precomputed at
   * SDE ingest (`computeHubProximity`), not per page load. Jita gets a wider
   * radius than the regional hubs to reflect its dominance as a market.
   */
  ROUTE_HUBS: [
    { systemId: 30000142, name: 'Jita', proximityJumps: 10 },
    { systemId: 30002187, name: 'Amarr', proximityJumps: 5 },
    { systemId: 30002659, name: 'Dodixie', proximityJumps: 5 },
    { systemId: 30002510, name: 'Rens', proximityJumps: 5 },
    { systemId: 30002053, name: 'Hek', proximityJumps: 5 },
  ],

  /** Per-scope ceilings for `ap_map.scope`. */
  MAX_MAPS_PER_SCOPE: { private: 3, corp: 1, alliance: 1 },

  /** Per-map system ceiling, enforced where `ap_map_system.visible = true`. */
  MAX_SYSTEMS_PER_MAP: 400,

  /** Max length of a map note's `title` (the on-node label). Enforced app-layer (Zod). */
  MAP_NOTE_TITLE_MAX_LENGTH: 20,

  /** Max length of a map note's free-form `content` body. Enforced app-layer (Zod). */
  MAP_NOTE_CONTENT_MAX_LENGTH: 1000,

  /**
   * EVE SSO OAuth2 endpoint paths, joined onto `AUTH_EVE_SSO_BASE`. Paths are
   * stable app constants; the base host is env-configurable (TQ vs SISI).
   */
  SSO_AUTHORIZE_PATH: '/v2/oauth/authorize',
  SSO_TOKEN_PATH: '/v2/oauth/token',
  SSO_JWKS_PATH: '/oauth/jwks',

  /**
   * Accepted `iss` claim values on EVE SSO JWT access tokens. CCP issues the
   * scheme-prefixed form (`https://login.eveonline.com`) on live tokens, but has
   * historically also used the bare host — accept both so verification is robust
   * to the inconsistency.
   */
  SSO_EXPECTED_ISSUER: ['login.eveonline.com', 'https://login.eveonline.com'],

  /** Refresh the access token this many seconds before it expires. */
  SSO_TOKEN_REFRESH_BUFFER_S: 120,

  /**
   * How often the Auth.js `jwt` callback re-evaluates login eligibility for an
   * already-issued session. On a restricted deployment a pilot who leaves the
   * owning corp/alliance keeps a valid JWT until this re-gate runs; when it does
   * (and `isLoginAllowed` now returns false) the session is invalidated and the
   * next navigation lands on `/access-denied`. The check reads the freshly-synced
   * corp/alliance from `ap_character` (no ESI on the hot path), so the cost is one
   * DB read at most once per interval per active session. Bounds revocation
   * staleness against that per-request read cost.
   */
  LOGIN_REGATE_INTERVAL_S: 300,

  /**
   * Default ESI scopes requested at login. Minimal location set plus public
   * data, widened by features that need more:
   *   - `esi-characters.read_corporation_roles.v1` — drives the Director →
   *     manager authz resolution in `syncCharacterAuthz`.
   *   - `esi-characters.read_titles.v1` — mirrors EVE corporation titles into
   *     `ap_role` (`source='corp_title'`) so per-map access can be granted by title.
   * Adding scopes invalidates existing access tokens; users re-consent on next login.
   */
  ESI_SCOPES: [
    'publicData',
    'esi-location.read_location.v1',
    'esi-location.read_ship_type.v1',
    'esi-location.read_online.v1',
    'esi-characters.read_corporation_roles.v1',
    'esi-characters.read_titles.v1',
    // Powers the corporation search in the structure-intel dialog. The ESI
    // `/characters/{id}/search/` endpoint gates ALL categories behind this one
    // scope despite its structure-specific name.
    'esi-search.search_structures.v1',
    // Powers the "Set destination" context-menu action — appends an on-map
    // system as an autopilot waypoint on the active character's in-game route.
    'esi-ui.write_waypoint.v1',
  ],

  /**
   * `character-cleanup` cron cadence. Drives both kick-expiry sweeps (5-minute
   * clearing latency on minimum 5-minute kicks is acceptable) and the authz
   * resync pass that throttles by `authz_synced_at`.
   */
  CHARACTER_CLEANUP_CRON: '*/5 * * * *',

  /**
   * `/api/health/ready` flags the `worker` component unhealthy if no `ap_job_run`
   * has *finished* within this window. `character-cleanup` runs every 5 minutes
   * (`CHARACTER_CLEANUP_CRON`), so 15 minutes (3 ticks) tolerates a slow/missed
   * tick without false-alarming a live worker.
   */
  HEALTH_WORKER_STALE_MS: 15 * 60 * 1000,

  /**
   * A character's `authz_level` is resynced by `character-cleanup` if
   * `authz_synced_at` is older than this (or NULL). 6 hours keeps director
   * status reasonably fresh without bombarding ESI for every active character
   * every cron tick.
   */
  CHARACTER_AUTHZ_RESYNC_STALE_AFTER_MS: 6 * 60 * 60 * 1000,

  /**
   * Per-tick batch cap for `character-cleanup`'s authz resync pass. Bounds ESI
   * call volume per tick; the next tick picks up the rest.
   */
  CHARACTER_AUTHZ_RESYNC_BATCH_SIZE: 25,

  /**
   * The ESI corporation role string that resolves a character to
   * `authz_level='manager'`. ESI returns role names with capital first letter
   * (per CCP's swagger); the comparison is case-sensitive.
   */
  AUTHZ_ADMIN_ROLE: 'Director',

  /**
   * In-game nominal lifetime of an `eol`-stage wormhole from the moment it goes
   * EOL: 4h. Drives the displayed countdown on EOL-flagged edges; the reap job
   * adds a grace buffer on top (`WORMHOLE_EOL_LIFETIME_MS`).
   */
  WORMHOLE_EOL_NOMINAL_MS: 14_400_000,

  /**
   * In-game nominal lifetime of a `critical`-stage wormhole from the moment it
   * enters the ~1h stage: 1h. Drives the displayed countdown; the reap job adds
   * a grace buffer on top (`WORMHOLE_EOL_CRITICAL_LIFETIME_MS`).
   */
  WORMHOLE_EOL_CRITICAL_NOMINAL_MS: 3_600_000,

  /**
   * Reap threshold for an `eol`-stage wormhole: the 4h nominal
   * (`WORMHOLE_EOL_NOMINAL_MS`) plus a 15% (36 minute) grace buffer = 4h36m.
   * Read by the EOL-expiry job to decide when to purge the row. The grace buffer
   * is internal: the displayed countdown runs to the nominal, not to this.
   */
  WORMHOLE_EOL_LIFETIME_MS: 16_560_000,

  /**
   * Reap threshold for a `critical`-stage wormhole: the 1h nominal
   * (`WORMHOLE_EOL_CRITICAL_NOMINAL_MS`) plus a 15-minute grace buffer = 1h15m.
   * The newer of EVE's two EOL warnings ("~1h left") selects this over the 4h36m
   * `WORMHOLE_EOL_LIFETIME_MS`.
   */
  WORMHOLE_EOL_CRITICAL_LIFETIME_MS: 4_500_000,

  /**
   * Reap threshold for an `expired`-stage wormhole, measured from `eol_at` (the
   * moment a scout manually marked it Expired): 4h. Longer than the worst-case
   * remaining life once EVE surfaces "expiration imminent" (max wormhole lifetime
   * is nominal + ~10% variance), so deleting the row is a safe bet that the hole
   * has collapsed in-game too. Read by the EOL-expiry job. The `expired` stage
   * shows an elapsed-since readout, not a countdown, so nothing displays this.
   */
  WORMHOLE_EXPIRED_LIFETIME_MS: 14_400_000,

  /**
   * Default lifetime of a (non-EOL) wormhole connection from creation: 48h. Used
   * for the canvas "expires in X" hint before the connection is flagged EOL, and
   * by the expired-connection cleanup cron as the practical lifetime cap.
   */
  WORMHOLE_DEFAULT_LIFETIME_MS: 172_800_000,

  /**
   * Default TTL applied to a newly created signature (`expires_at = created_at +
   * this`): 48 hours — the maximum a wormhole can stay open in EVE, so a sig
   * nobody has re-scanned in that long is presumed gone.
   */
  SIGNATURE_DEFAULT_TTL_MS: 172_800_000,

  /**
   * graphile-worker concurrency: how many task handlers may run in parallel in
   * one worker process. The current task set is light (housekeeping deletes +
   * one ESI fetch); a single worker is enough.
   */
  JOB_WORKER_CONCURRENCY: 4,

  /**
   * graphile-worker job poll interval (ms). LISTEN/NOTIFY drives dispatch on
   * the fast path; this is the fallback poll cadence for scheduled retries.
   */
  JOB_POLL_INTERVAL_MS: 2_000,

  /**
   * `ap_job_run.error_text` cap. Caller's `Error.message` is truncated to keep
   * pathological stack traces from blowing up the row.
   */
  JOB_INSTRUMENTATION_ERROR_MAX_LENGTH: 2_000,

  /**
   * `ap_job_run.notes` cap, applied to `JSON.stringify(notes).length`. A handler
   * that returns a 1 MB blob shouldn't ship to history; large details belong in
   * `ap_map_event` or job logs.
   */
  JOB_INSTRUMENTATION_NOTES_MAX_BYTES: 8_000,

  /**
   * 1-in-N success sampling for high-frequency `ap_job_run` writers (location-poll
   * is ~98% of all rows). Every failure is still persisted; a sampled success row
   * carries `weight = N` so the admin job-success chart scales the sample back up.
   * N = 1 disables sampling (every success persisted).
   */
  JOB_INSTRUMENTATION_SUCCESS_SAMPLE: 50,

  /**
   * Maps soft-deleted (`ap_map.deleted_at IS NOT NULL`) more than this many
   * days ago are hard-purged at EVE downtime.
   */
  MAP_PURGE_GRACE_DAYS: 30,

  /**
   * Batch cap for housekeeping jobs that delete row-by-row through
   * `commitMapEvent`. Bounds the per-run worst case: a thundering pg_notify
   * herd at downtime is still bounded, and a partial batch means the next
   * run picks up the rest.
   */
  JOB_DELETE_BATCH_SIZE: 500,

  /**
   * Histogram bucket upper-bounds (ms) for `esi_request_duration_ms`. Finite
   * `le` boundaries in Prometheus semantics (a `+Inf` bucket is implied by the
   * total count). Spans a fast cache hit (~5ms) to the per-request timeout
   * (`ESI_REQUEST_TIMEOUT_MS` = 5000ms).
   */
  METRICS_ESI_LATENCY_BUCKETS_MS: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],

  /**
   * Histogram bucket upper-bounds (ms) for `route_plan_duration_ms`. Route
   * planning is an in-memory Dijkstra over the cached K-space graph plus a few
   * small DB reads — sub-millisecond to tens of milliseconds in practice.
   */
  METRICS_ROUTE_LATENCY_BUCKETS_MS: [1, 2, 5, 10, 25, 50, 100, 250, 500],

  /**
   * Histogram bucket upper-bounds (ms) for `http_request_duration_ms` —
   * Aperture's own HTTP surface (the per-route `withApiMetrics` wrapper). Spans a
   * trivial 4xx short-circuit (~5ms) to a slow mutation (a few seconds).
   */
  METRICS_HTTP_LATENCY_BUCKETS_MS: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],

  /**
   * Histogram bucket upper-bounds (ms) for `job_duration_ms`. Background jobs run
   * longer than requests — a location-poll round-trips ESI, a snapshot/reap scans
   * partitions — so the buckets reach a full minute.
   */
  METRICS_JOB_DURATION_BUCKETS_MS: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],

  /**
   * Histogram bucket upper-bounds (ms) for `realtime_fanout_duration_ms` — the
   * in-process `dispatch()`→deliver span in `bus.ts`. In-process fanout is
   * sub-millisecond to tens of milliseconds.
   */
  METRICS_FANOUT_LATENCY_BUCKETS_MS: [1, 2, 5, 10, 25, 50, 100, 250],

  /**
   * `metrics-snapshot` cron cadence. Samples the in-process registry + gauges
   * into `ap_metric_snapshot` for the admin metrics page's history graphs.
   * 1-minute resolution over the 30-day retention is ~43k rows — trivial for
   * Postgres; the read path buckets it down per selected range.
   */
  METRICS_SNAPSHOT_CRON: '*/1 * * * *',

  /**
   * Instance-alerting evaluation cadence. The alert loop is an in-process
   * `setInterval` booted from `server.ts` (NOT a graphile-worker cron) so its
   * scheduling does not depend on a healthy DB — the whole point of Phase 6 is
   * to alert on DB degradation, which a DB-backed cron could never do.
   */
  ALERT_EVALUATE_INTERVAL_MS: 60_000,
  /**
   * Hard ceiling on the alert loop's `SELECT 1` DB probe. A hung/overloaded DB
   * must surface as `down` quickly rather than wedging the loop; the probe races
   * this timeout and a failure (timeout or error) is itself the alert signal.
   */
  ALERT_DB_PROBE_TIMEOUT_MS: 2_000,

  /**
   * A DB probe that succeeds but takes longer than this is reported `degraded`
   * (overloaded / restarting / contended) rather than `ok`.
   */
  ALERT_DB_SLOW_MS: 1_000,

  /**
   * Consecutive bad evaluations before a rule transitions healthy→firing. At the
   * 1-minute `ALERT_EVALUATE_INTERVAL_MS` this is the debounce window (≈2 min) —
   * it is how "breaker open > X min" is honored without tracking breaker
   * duration, and it swallows transient single-tick blips.
   */
  ALERT_DEBOUNCE_EVALUATIONS: 2,

  /** Open ESI circuit breakers at/above which the `esi_breakers` rule goes bad. */
  ALERT_ESI_BREAKERS_OPEN_THRESHOLD: 2,

  /**
   * An `ap_job_run` row still un-ended this long after `started_at` means the
   * worker died mid-handler (a true abandon), not a job legitimately in flight.
   */
  ALERT_JOB_ABANDONED_MS: 10 * 60 * 1000,

  /** Lookback window for the `error_rate` rule's `ap_error_log` count. */
  ALERT_ERROR_RATE_WINDOW_MS: 5 * 60 * 1000,

  /** error|fatal `ap_error_log` rows within the window at/above which it fires. */
  ALERT_ERROR_RATE_THRESHOLD: 25,

  /**
   * Fixed-window length for the `/api/client-errors` ingest rate limiter
   * (Phase 7 client error capture). Per-session and global counters reset once a
   * window elapses; a browser render loop is bounded to the caps below per window.
   */
  CLIENT_ERROR_RATE_WINDOW_MS: 60_000,

  /** Max client-error reports accepted per session per window before dropping (429). */
  CLIENT_ERROR_MAX_PER_SESSION: 20,

  /** Max client-error reports accepted across all sessions per window (flood ceiling). */
  CLIENT_ERROR_MAX_GLOBAL: 200,

  /** `message` cap (chars) on an ingested client error before it hits `ap_error_log`. */
  CLIENT_ERROR_MESSAGE_MAX_LENGTH: 1_000,

  /** `stack` / `componentStack` cap (chars) on an ingested client error. */
  CLIENT_ERROR_STACK_MAX_LENGTH: 8_000,

  /**
   * Server-side lifetime of a cached public share snapshot, keyed by share
   * token. The projection is viewer-independent, so one render serves every
   * viewer of a token — that cache is what keeps a large anonymous audience
   * off the database. Short enough that a revoked token stops resolving
   * promptly even without an explicit invalidation.
   */
  PUBLIC_SNAPSHOT_CACHE_TTL_MS: 5_000,

  /** Distinct share tokens held in the snapshot cache before LRU eviction. */
  PUBLIC_SNAPSHOT_CACHE_MAX_ENTRIES: 200,

  /**
   * Fixed-window length for the `/api/public/[token]/snapshot` rate limiter.
   * Per-IP and global counters reset once a window elapses.
   */
  PUBLIC_SNAPSHOT_RATE_WINDOW_MS: 60_000,

  /** Max snapshot requests accepted per client IP per window before 429. */
  PUBLIC_SNAPSHOT_MAX_PER_IP: 120,

  /** Max snapshot requests accepted across all clients per window (flood ceiling). */
  PUBLIC_SNAPSHOT_MAX_GLOBAL: 6_000,

  /**
   * Outbound links the spectator view's promo bar offers a logged-out visitor.
   * The instance itself is always the deployment root, so only the project's
   * source needs naming here.
   */
  PUBLIC_LINKS: {
    repo: 'https://github.com/KitchenSinkhole/aperture',
  },

  /** WebSocket upgrade path for token-authed public spectator sockets, structurally separate from `WS_PATH`. */
  WS_PUBLIC_PATH: '/ws/public/map',

  /** Live public sockets a single share token may hold at once; upgrades past this get a 503 and the client degrades to polling. */
  PUBLIC_WS_MAX_PER_TOKEN: 500,

  /**
   * Fixed-window length for the public WS upgrade rate limiter. Per-IP and
   * global counters reset once a window elapses, mirroring
   * `PUBLIC_SNAPSHOT_RATE_WINDOW_MS`.
   */
  PUBLIC_WS_UPGRADE_WINDOW_MS: 60_000,

  /** Max public WS upgrades accepted per client IP per window before a 429. */
  PUBLIC_WS_MAX_UPGRADES_PER_IP: 30,

  /** Max public WS upgrades accepted across all clients per window (flood ceiling). */
  PUBLIC_WS_MAX_UPGRADES_GLOBAL: 3_000,

  /** Minimum spacing between `publicUpdate` nudges sent to one public socket; a burst of edits collapses to one trailing nudge per interval. */
  PUBLIC_WS_NUDGE_MIN_INTERVAL_MS: 1_000,

  /**
   * A spectator client schedules its post-nudge snapshot refetch at
   * `PUBLIC_SNAPSHOT_CACHE_TTL_MS` plus a random amount up to this, so a
   * synchronized audience doesn't all refetch on the same tick.
   */
  PUBLIC_REFETCH_JITTER_MS: 2_000,

  /** Snapshot poll cadence a spectator client falls back to when its public socket is down. */
  PUBLIC_POLL_INTERVAL_MS: 15_000,

  /** Idle-map refetch backstop for a spectator client — the only thing that notices `expires_at` elapsing on a map nobody is editing. */
  PUBLIC_IDLE_REFRESH_MS: 120_000,

  /**
   * Max `characterIds` a single `/api/integrations/activity-stats` request may
   * bound its result to. Bounds response size and query fan-out; callers over
   * the cap page across multiple requests (400 on overflow).
   */
  INTEGRATION_MAX_CHARACTER_IDS: 500,

  /**
   * `POST /api/integrations/presence-sessions` window when `from` is omitted:
   * `to` minus this many days. Sessions are far more numerous than daily
   * activity rollup rows, so unlike `activity-stats` the window can't default
   * to unbounded.
   */
  INTEGRATION_PRESENCE_DEFAULT_WINDOW_DAYS: 90,

  /**
   * Widest `[from, to]` span `/api/integrations/presence-sessions` accepts; a
   * wider request is a 400 telling the caller to page.
   */
  INTEGRATION_PRESENCE_MAX_WINDOW_DAYS: 366,
} as const;

export type ApertureConfig = typeof apertureConfig;
