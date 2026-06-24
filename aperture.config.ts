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
   * How long a wormhole connection has left from the moment it goes EOL to the
   * point a reap job would purge it: 4h nominal + 15m safety buffer. Read by the
   * EOL-expiry job and surfaced as a countdown on EOL-flagged edges.
   */
  WORMHOLE_EOL_LIFETIME_MS: 15_300_000,

  /**
   * How long a wormhole connection has left from the moment it enters the
   * *critical* (1h) EOL stage to the point the reap job purges it. Mirrors
   * `WORMHOLE_EOL_LIFETIME_MS`'s 15-minute safety buffer beyond the in-game
   * nominal: 1h + 15m = 4_500_000 ms. The newer of EVE's two EOL warnings
   * ("~1h left") selects this constant over the 4h `WORMHOLE_EOL_LIFETIME_MS`.
   */
  WORMHOLE_EOL_CRITICAL_LIFETIME_MS: 4_500_000,

  /**
   * Default lifetime of a (non-EOL) wormhole connection from creation: 48h. Used
   * for the canvas "expires in X" hint before the connection is flagged EOL, and
   * by the expired-connection cleanup cron as the practical lifetime cap.
   */
  WORMHOLE_DEFAULT_LIFETIME_MS: 172_800_000,

  /**
   * Default TTL applied to a newly created signature (`expires_at = created_at +
   * this`): 5 days.
   */
  SIGNATURE_DEFAULT_TTL_MS: 259_200_000,

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
} as const;

export type ApertureConfig = typeof apertureConfig;
