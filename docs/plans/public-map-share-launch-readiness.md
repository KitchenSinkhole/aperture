# Public Map Share: Launch Readiness

**Goal:** Confirm by measurement that the public instance survives being advertised, and know the number at which it stops surviving.

**References:**
- `docs/plans/public-map-share.md` (Stages 1 to 6, shipped; this doc replaces its Stage 7 stub)
- `aperture.config.ts` (`PUBLIC_*` block, lines ~470 to 545) for every cap named below
- `src/lib/map/publicSnapshot.md` (cache + snapshot rate limiter)
- `src/lib/realtime/publicSockets.md`, `src/lib/realtime/wsServer.md` (upgrade admission)
- `src/lib/metrics/gauges.md`, `src/lib/metrics/prometheus.md` (what is observable)

**Already done (this session):** the observability gap is closed. `public_ws_connections` (gauge) and `public_ws_upgrades_total{outcome}` (counter, outcomes `accepted` / `rate_limited` / `unauthorized` / `at_cap`) are live on `/api/metrics`. Before this, `ws_connections` counted only session sockets and the three upgrade rejection paths emitted nothing, so spectator load was invisible. Every stage below depends on those two series existing, which means **prod must be running a build that includes them** before Stage B is meaningful.

**Target:** 500 concurrent spectators, which is exactly `PUBLIC_WS_MAX_PER_TOKEN`. Chosen so the run proves the degradation path fires cleanly, not just the happy path.

**Host:** the existing alliance prod box. There is no separate public instance. Alliance live operations share this hardware, so any prod-side load test is a scheduled, announced window.

---

## Stage A: prod blocker re-verification

**Mode:** Plan mode
**Touches:** nothing. Read-only SSH plus `/api/metrics`.
**Goal:** Re-measure the three known public-deployment blockers on the live box. All three have shipped fixes. This stage confirms the fixes are working in production, rather than confirming they exist in the diff.

Connection path from the prior investigation: Proxmox host `94.130.222.95`, LXC 115 `aperture`, containers `aperture-app-1` and `aperture-db-1`, single Node process with web, worker, and realtime embedded. These coordinates are a month old. Confirm them before trusting them.

Prefer `/api/metrics` over psql wherever it can answer, since it needs no database credentials.

**A1. `ap_job_run` growth is bounded.**
The pre-fix state was roughly 14.5M rows and 4130 MB, about 91% of the database, growing around 340 MB/day. The fix was success-sampling in `withInstrumentation` plus partman retention.
- `db_table_rows{table="ap_job_run"}` against that baseline.
- `pg_total_relation_size` for the table and its partition set, in `aperture-db-1`.
- Confirm sampling is genuinely in effect: the `job_runs_total{task="location-poll"}` rate should exceed the `ap_job_run` insert rate by roughly `JOB_INSTRUMENTATION_SUCCESS_SAMPLE`.
- **Check for rows stranded in a `*_default` partition.** A stalled partition-maintenance job wedges `run_maintenance` permanently and silently reintroduces the disk bomb. This is the specific failure mode that has bitten this deployment before, so check it directly rather than trusting that retention "looks configured".

**A2. No zombie location-poll backlog.**
The prior state was 19,552 dead `location-poll` rows with a NULL job key, inert but inflating the `job_backlog` gauge.
- Raw count in `graphile_worker._private_jobs` where `task_identifier = 'location-poll'`, key is NULL, and `attempts >= max_attempts`.
- Cross-check against the `job_backlog` and `jobs_abandoned` gauges. `countJobBacklog` filters `attempts < max_attempts`, so a large raw count next to a small gauge is the expected shape only if something is reaping those rows. A raw count that grows between two samples is the bug returning.

**A3. Killmail fetches sit far under the shared ESI bucket.**
`getKillmail` is unauthenticated, so CCP's rate limiting collapses it to one app-wide bucket: 1,800 fetches per rolling 15 minutes, shared across every user. No hardware moves that ceiling. The fix was the persistent `universe_killmail` cache.
- `esi_requests_total{operationId="GetKillmailsKillmailIdKillmailHash"}` rate over 15 minutes against the 1,800 budget.
- `esi_breakers_open`, which previously showed spurious killmail breaker trips from 429s misread as failures.
- `db_table_rows{table="universe_killmail"}` to confirm the cache is populated and serving.
- Note the spectator view carries no kill data at all (dropped permanently in Stage 2, migration 0062), so public audience size does not drive this number. Authenticated sidebar opens do, and a public launch drives those indirectly.

**Done when:** each of the three has a measured number written into this doc, next to the threshold it must stay under.

---

## Stage B: load test to 500 concurrent spectators

**Mode:** Accept edits
**Touches:** `scripts/load-public-share.ts` (new) and its companion `.md`.
**Goal:** Find the first surface that breaks, and the number at which it breaks.

No load-test tooling exists in the repo. `tsx` and `ws` are both already dependencies, so a script under `scripts/` following the existing convention installs nothing new.

**Drive four surfaces, not one.** The JSON snapshot is the cheapest of them and is the only one that is rate-limited:

| Surface | Cost per request | Protected by |
|---|---|---|
| `GET /api/public/[token]/snapshot` | cached 5s, misses coalesced onto one in-flight promise | 120/IP/min, 6,000/min global |
| `GET /live/<token>` | **full SSR React render, every request** (shares the snapshot cache, so the data is cheap and the render is not) | nothing |
| `GET /live/<token>/opengraph-image` | **satori render plus a font read from disk, every request** | nothing |
| `WSS /ws/public/map?token=` | one socket, one bus subscription | 500/token, 30 upgrades/IP/min |

The two unprotected rows are the reason this stage is not just "hammer the JSON endpoint". One link pasted into a large Discord fans out to many unfurlers hitting the OG route simultaneously, and every human who clicks pays for an SSR render.

**Three phases:**
1. Ramp to 500 sockets and hold. Watch memory and event-loop lag flatten or not.
2. Drive real edits on the shared map to generate nudges. Measure end to end nudge to rendered update against the `PUBLIC_WS_NUDGE_MIN_INTERVAL_MS` plus `PUBLIC_REFETCH_JITTER_MS` budget.
3. Push past 500. Confirm `at_cap` increments, the client degrades to `PUBLIC_POLL_INTERVAL_MS` polling, and no client-side errors surface.

Run against local or staging first to shake out the harness. Only then a short announced window on prod.

**Watch:** `public_ws_connections`, `public_ws_upgrades_total{outcome}`, `http_requests_total{route="/api/public/:token/snapshot",status}` for 429s, `http_request_duration_ms` across all three HTTP surfaces, `event_loop_lag_ms`, `process_resident_memory_bytes`, `db_pool_waiting_connections`.

**Predicted cut-offs, to confirm or refute:**

| Limit | Where it comes from | Predicted effect |
|---|---|---|
| 500 sockets per token | `PUBLIC_WS_MAX_PER_TOKEN`, hard | 501st spectator polls instead of streaming, by design |
| ~650 active viewers | 6,000/min global cap divided by roughly 9 refetches per viewer per minute under continuous editing | global 429s begin |
| SSR and OG render throughput | unmeasured | the likely real ceiling, and the reason this stage exists |

**Done when:** 500 sockets held with acceptable latency and lag, the past-cap fallback verified, and the first surface to break named with its number.

---

## Stage C: deployment confirmations

**Mode:** Plan mode
**Touches:** nothing, unless a finding turns into its own stage.

- **Confirm `x-forwarded-for` actually reaches the app.** Both public rate limiters key on `clientKeyFromForwardedFor` (`src/lib/http/clientKey.ts`). If the reverse proxy in front of prod does not set the header, every spectator collapses onto a single client key and the 120/min per-IP cap throttles the entire audience as though it were one abuser. This is the highest-consequence item in this stage and the cheapest to check. Verify against the real proxy, before the event.
- **Confirm prod still runs one Node process.** The snapshot cache, both rate limiters, and the per-token socket cap are all in-process `globalThis` state. Under horizontal scaling every cap multiplies by process count and none of them mean what they say.
- **Confirm the domain resolves, TLS is valid, and the WSS upgrade survives the proxy.** `/ws/public/map` is structurally separate from `WS_PATH` and may need its own proxy rule.
- **Decide on share URL length.** A token is `randomBytes(16).toString('base64url')`: 22 random characters, giving `https://<domain>/live/AbCd...`. Unguessable, which is the point, and fine to click from Discord. Not readable off a stream overlay by someone typing it. Either accept that spectators arrive by clicking a posted link, or decide a short human-typeable alias is wanted. The alias is new feature work and belongs in its own plan, not here.

**Done when:** the measured headroom and the named cut-off are written back into this doc, and the URL question has an answer.

---

## Out of scope

Broadcast delay (still listed as open in `public-map-share.md`), any short-alias URL scheme, and horizontal scaling of the public surfaces.
