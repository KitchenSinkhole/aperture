# User API Tokens

**Goal:** Let any map viewer mint per-map, read-only bearer tokens for their own tools, with the map's managers deciding whether the API is on and which data scopes it exposes, and with rate limiting and automatic abuse punishment in the first release (issue #293).

**References:** CLAUDE.md (Mutation pathways, Database, Auth & ESI, Config, Lifecycle patterns, companion rules), issue #293, `src/lib/auth/rights.md`, `src/lib/auth/blackout.md`, `src/lib/map/publicSnapshot.md` (the cache + limiter pattern this feature copies), `src/lib/integrations/token.md` (the hashed-token pattern), `src/app/(app)/actions/mapShares.md` (the closest existing management surface).

**Not this:** the corp-scoped `/api/integrations/*` API (operator-minted, consumed by Roster) is untouched. Nothing here shares a table, a route or a token format with it.

---

## Design

Everything in this section is settled. Stages implement it; they do not reopen it.

### Decisions taken with the user

- **Read-only.** v1 has no write scope. Scope names are plain nouns so a later `signatures:write` style addition does not collide.
- **Six scopes:** `map`, `signatures`, `pilots`, `notes`, `mass_log`, `kills`.
- **Account block:** instance-wide, on the account (`ap_user`), so every character on it is covered. First offence 7 days. A second offence within 180 days of the previous block starting is indefinite until a global admin lifts it. While blocked, the account cannot mint and every token its characters created answers 403.
- **Blackout:** a token sees exactly what its creator sees. An uncleared creator's token gets only that account's own pilots and a hidden mass log. A cleared creator's token keeps the full picture.
- **A token belongs to an account, not a character.** Everything a user does is attributed to their main, so tokens are too: one set of tokens per person, never one per character. "Creator" and "owner" below always mean the account.
- **60 requests a minute per token.**

### Decisions taken in this design (veto before Stage 1 if any is wrong)

- **An account's access is its main's access.** View authority in `rights.ts` is per character (corp match, title overlay), and login lands every session on the account's main, so the main is the character the app itself judges the account by. A token is therefore authorised on every request by `canViewMap(account's current main, map)`, plus the login gate on that main. It follows the main: change your main and your tokens are judged by the new one. An account with no main set fails closed (`access_lost`). Wherever a token's owner is shown or recorded, it is shown as the account's main.
- **New delegatable capability `api_manage`.** Enabling the API, choosing scopes, and seeing or revoking other people's tokens is gated by `requireMapCapability(…, 'api_manage')`, the same shape as `share_manage`. Managers hold it implicitly; a corp Director can delegate it to a title.
- **Operator kill switch.** `ap_instance.user_api_enabled` (default true), toggled in `/admin/settings`. Off means the whole `/api/v1/*` group answers 404 and minting is refused. Maps are still off by default individually.
- **Open CORS.** `/api/v1/*` never reads a cookie, so `Access-Control-Allow-Origin: *` carries no ambient authority and lets browser-based tools work.
- **The API path never calls zKillboard or ESI.** The `kills` scope reads only the local `universe_killmail` cache, which the live feed starts filling for on-map systems (Stage 7). Coverage is best-effort and documented as such.
- **Account deletion clears a block.** Same accepted orphaning CLAUDE.md documents for kick and ban: the block lives on `ap_user` and goes with it.
- **No IP is ever persisted.** IP-keyed limiter state is in-process, fixed-window, and discarded when the window rolls.

### Out of scope for v1

Writes of any kind. Push (webhooks, token-authed sockets). An instance-wide admin token browser (Prometheus series plus the members page cover the operator in v1). Detection of "scraping patterns": every endpoint returns one whole cached resource for one map, so there is nothing to enumerate and nothing to detect beyond request volume.

### Data model

**`ap_map`** gains:
- `api_enabled boolean NOT NULL DEFAULT false`
- `api_scopes api_scope[] NOT NULL DEFAULT '{}'`

**`ap_map_api_token`** (new):

| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` PK | |
| `map_id` | `bigint` NOT NULL | FK `ap_map` CASCADE |
| `user_id` | `integer` NOT NULL | FK `ap_user` CASCADE. The owning account. It is the token's authority, not an audit column, so the token dies with the account. |
| `token_hash` | `text` NOT NULL UNIQUE | sha256 hex of the raw token |
| `token_prefix` | `text` NOT NULL | first 6 characters of the random part, for telling tokens apart in lists |
| `label` | `text` NOT NULL | 1 to 60 chars |
| `scopes` | `api_scope[]` NOT NULL | fixed at mint |
| `expires_at` | `timestamptz` NULL | NULL means no expiry |
| `created_at` | `timestamptz` NOT NULL DEFAULT now() | |
| `last_used_at` | `timestamptz` NULL | batched write, see Usage |
| `request_count` | `bigint` NOT NULL DEFAULT 0 | batched write |
| `suspended_until` | `timestamptz` NULL | |
| `strike_count` | `integer` NOT NULL DEFAULT 0 | |
| `last_strike_at` | `timestamptz` NULL | |
| `revoked_at` | `timestamptz` NULL | non-null means revoked; never a row delete |
| `revoked_reason` | `api_token_revoke_reason` NULL | `creator` / `manager` / `abuse` / `admin` |
| `revoked_by_character_id` | `bigint` NULL | FK `ap_character` SET NULL (audit) |

Indexes on `map_id` and on `user_id`. A token is **live** when `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.

**`ap_user`** gains `api_blocked_at timestamptz`, `api_blocked_until timestamptz`, `api_block_reason text`. The account is **blocked** when `api_blocked_at IS NOT NULL AND (api_blocked_until IS NULL OR api_blocked_until > now())`. `api_blocked_at` is kept after a block ends (it is "when the most recent block began", which is what the repeat-offence window reads). An admin lift sets `api_blocked_until = now()`. No job clears anything: the state is evaluated at read time.

**`ap_instance`** gains `user_api_enabled boolean NOT NULL DEFAULT true`.

**Enums:** new `api_scope` (`map`, `signatures`, `pilots`, `notes`, `mass_log`, `kills`); new `api_token_revoke_reason`; `map_capability` gains `api_manage`.

**`ap_event_kind`** gains six rows, category `access`: `api.enabled`, `api.disabled`, `api.scopes_changed`, `api.token_created`, `api.token_revoked`, `api.token_suspended`.

### Token format

`apu_` followed by `randomBytes(32)` as base64url. The prefix lets the pipeline reject garbage without a database read and lets secret scanners and the log scrubber recognise it. Only the sha256 hex digest is stored. The raw value is returned once, by the mint action, and is not recoverable.

Transport is `Authorization: Bearer <token>` only. There is no `?token=` fallback.

### Request pipeline

Every `/api/v1/*` route is a thin handler behind one wrapper. The wrapper runs these steps in this order, and the order is part of the contract:

1. **Instance switch.** `user_api_enabled` false: 404 for everything.
2. **IP gate.** Fixed-window per-IP request cap, and a check of the per-IP failed-auth block (below). Runs before any token work so guessing costs the guesser. IP comes from `clientKeyFromForwardedFor`.
3. **Parse.** Missing header, wrong scheme, or a value that is not `apu_` plus the right length: 401, counted as a failed auth for the IP, no database read.
4. **Resolve.** Hash, then look up the token with its map, its owning account and that account's main character in one read. Served from a short-TTL in-process cache keyed by hash (misses are cached too).
5. **Decide.** A pure function over the resolved record:

   | Condition | Answer |
   |---|---|
   | unknown, revoked, expired, or parent map soft-deleted | 401 `invalid_token` (indistinguishable from each other) |
   | account blocked | 403 `account_blocked` |
   | token suspended | 403 `token_suspended`, with `Retry-After` |
   | map `api_enabled` false | 403 `api_disabled` |
   | the account has no main, or its main fails `canViewMap`, or its main fails the login gate on its cached affiliation (the same `isLoginAllowed` check the session re-gate in `auth.ts` runs) | 403 `access_lost` |

6. **Rate limit.** Per token, then per account, then global. Over any: 429 `rate_limited` with `Retry-After`.
7. **Scope.** The route's scope must be in `token.scopes ∩ map.api_scopes`, computed per request. Otherwise 403 `scope_not_granted`.
8. **Serve** from the projection cache, with ETag handling.

Rate limiting sits before the scope check on purpose, so a tool hammering a scope it does not hold is still limited and still accrues strikes.

**Freshness of revocation.** The decide step's inputs are cached for `USER_API_AUTH_CACHE_TTL_MS`. Explicit actions (revoke, suspend, map settings change, account block or lift, the Blackout switch) invalidate the relevant entries in-process, so they apply to the very next request. Changes the server only observes (kick, ban, leaving the corp, a cleared-list edit) apply within the TTL. There is one process (`server.ts`), so in-process invalidation is complete.

**Response envelope.** Success: `{ ok: true, data, generatedAt }`. Failure: `{ ok: false, error, code }`, where `code` is the stable machine-readable string from the tables above and `error` is prose. Every response carries `cache-control: private, no-store`, `x-robots-tag: noindex`, the CORS headers, and `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`. 401s carry `WWW-Authenticate: Bearer`.

### Endpoints

All `GET`. The token alone selects the map; no endpoint takes a map id.

| Path | Scope | Returns |
|---|---|---|
| `/api/v1/token` | none | the token's map (`id`, `name`), granted and currently effective scopes, expiry, and the rate limit it is subject to |
| `/api/v1/map` | `map` | map header, visible systems, confirmed connections |
| `/api/v1/signatures` | `signatures` | signatures in visible systems |
| `/api/v1/pilots` | `pilots` | online tracked pilots, as the creator may see them under Blackout |
| `/api/v1/notes` | `notes` | free-standing map notes, plus each system's intel-notes text |
| `/api/v1/mass-log` | `mass_log` | per-jump log entries for the map's current connections; optional `?connection=<id>` |
| `/api/v1/kills` | `kills` | cached kills in on-map systems; `?since=<ISO>` (default 24h back, floor 7 days), `?limit=` (max 200) |

**Projection rules** (the DTOs are their own types, not `MapViewData`, so an internal refactor cannot change the wire contract):
- Same visibility predicates as `loadMapForView`: visible systems only; connections confirmed and with both endpoints visible.
- Bigints as strings, timestamps as ISO.
- No account linkage anywhere: no `userId`. A pilot entry mirrors `MapPresenceEntry` minus `userId`; it keeps `mainCharacterId` / `mainCharacterName`.
- Intel-notes text belongs to `notes`, never to `map`.
- `pilots` goes through `loadMapPresence(mapId, viewer)` with the owning account's `BlackoutViewer` (Blackout clearance is already per account). It is the seventh presence egress and uses the same seam as the other six.
- `mass_log` answers `{ data: [], hidden: true }` while `isBlackedOut(creator)`, matching the in-app route.
- `kills` entries carry ids and the SDE ship-type name only. No name resolution against ESI.

**Projection cache.** In-process, short TTL, LRU-bounded, concurrent misses coalesced onto one in-flight load: the `publicSnapshot.ts` pattern. `map`, `signatures`, `notes` and `kills` are viewer-independent and keyed by `(mapId, resource)`. `pilots` and `mass_log` are keyed by `(mapId, resource, visibility)` where visibility is `full` or `own:<userId>`. Each entry stores its serialised body and a weak ETag; `If-None-Match` answers 304. A 304 still costs one request against the limit.

### Rate limits

All hard-coded in `aperture.config.ts` under a `USER_API_*` block. Fixed-window counters on a `globalThis` singleton; per-key maps are cleared when the window rolls, which bounds memory regardless of how many keys were seen.

| Constant | Value | Meaning |
|---|---|---|
| `USER_API_PROJECTION_TTL_MS` | 5 000 | data cannot be fresher than this, so polling faster buys nothing |
| `USER_API_AUTH_CACHE_TTL_MS` | 10 000 | upper bound on how long an observed access loss takes to apply |
| `USER_API_RATE_WINDOW_MS` | 60 000 | window for every counter below |
| `USER_API_MAX_PER_TOKEN` | 60 | all seven endpoints every 10s is 42 |
| `USER_API_MAX_PER_ACCOUNT` | 150 | summed over every token the account owns, so minting more tokens does not multiply the budget |
| `USER_API_MAX_GLOBAL` | 6 000 | whole-API ceiling |
| `USER_API_MAX_PER_IP` | 600 | generous, many tokens can sit behind one NAT |
| `USER_API_MAX_AUTH_FAILURES_PER_IP` | 20 | failed auths per window before the IP is blocked |
| `USER_API_IP_BLOCK_STEPS_MS` | 1 min, 5 min, 30 min | escalating IP block for repeat failed-auth windows |
| `USER_API_MAX_TOKENS_PER_ACCOUNT_PER_MAP` | 3 | live tokens |
| `USER_API_MAX_TOKENS_PER_ACCOUNT` | 20 | live tokens, all maps |

### Abuse ladder

Abuse has one definition: **continuing to send requests after being told to stop.** A client that honours `Retry-After` can never trigger it.

- A **hot window** is a rate window in which one token had at least `USER_API_HOT_WINDOW_REJECTS` (60) requests refused. Refusals that count: token limit, account limit, and requests sent while suspended. Global-ceiling refusals do not count; that is the server's problem, not the client's.
- A **strike** is `USER_API_STRIKE_HOT_WINDOWS` (3) hot windows inside `USER_API_STRIKE_SPAN_MS` (10 min). Hot-window history is in-process; strikes are persisted on the token row.
- `strike_count` resets to zero if `last_strike_at` is older than `USER_API_STRIKE_DECAY_DAYS` (7) when the next strike lands.

| Strike | Consequence |
|---|---|
| 1 | token suspended 15 minutes |
| 2 | token suspended 6 hours |
| 3 | token revoked (`revoked_reason='abuse'`), and the account is blocked |

A client that keeps hammering through a suspension keeps producing hot windows, so it walks itself up the ladder without anyone watching. After revocation its requests are failed auths and feed the IP block.

**Account block on strike 3:** `api_blocked_at = now()`; `api_blocked_until = now() + 7 days`, or NULL (indefinite) if the previous `api_blocked_at` is within `USER_API_REPEAT_OFFENCE_WINDOW_DAYS` (180). A global admin can also block by hand (indefinite, reason required) and lift any block.

### Usage

`last_used_at` and `request_count` are accumulated in-process and flushed in one batched `UPDATE` at most once per `USER_API_USAGE_FLUSH_MS` (60 000). They are approximate by design and lose at most one interval on a restart. Request volume is not audit data and never enters `ap_map_event`.

Prometheus: `user_api_requests_total{endpoint,outcome}` (outcome is one of `ok`, `not_modified`, `rate_limited`, `unauthorized`, `forbidden`), `user_api_strikes_total{level}`, and gauges `user_api_tokens_live` / `user_api_tokens_suspended`.

### Audit

Each of these is one `commitMapEvent`, so it reaches the map audit log, every viewer's socket, and the Discord history webhook, exactly like `share.created`. No payload ever carries the token, its hash or its prefix.

| Kind | Actor | Payload |
|---|---|---|
| `api.enabled` | manager | `scopes` |
| `api.disabled` | manager | none |
| `api.scopes_changed` | manager | `added`, `removed` |
| `api.token_created` | creator | `tokenId`, `label`, `scopes`, `expiresAt` |
| `api.token_revoked` | creator or manager; NULL for automation | `tokenId`, `label`, `ownerCharacterId`, `ownerName`, `reason` |
| `api.token_suspended` | NULL (automation) | `tokenId`, `label`, `ownerCharacterId`, `ownerName`, `until`, `strike` |

One settings save is one event: a flipped switch yields `api.enabled` (carrying the scopes it was enabled with) or `api.disabled`; a scope edit with the switch unchanged yields `api.scopes_changed`. `api.token_revoked` and `api.disabled` join the audit console's destructive set.

The actor on a creator's own event is the session character (sign-in lands the session on the account's main). `ownerCharacterId` / `ownerName` are the owning account's main at the time of the event.

A token going inert because its creator lost access is not an event (nothing was mutated). It shows as a computed status in the manager's list.

Account blocks are not map-scoped and write no `ap_map_event`, consistent with kick and ban. They are logged at `warn` through the structured logger and shown on `/admin/members`.

### UI

**Map Settings dialog, new "API" tab.** Shown to a viewer when the map's API is enabled, or when the viewer holds `api_manage`.
- *Manager block* (`api_manage` only): the enable switch; one checkbox per scope with a one-line description that says plainly what leaves the map (`pilots` and `mass_log` both say they include pilot names); Save. Below it, every live token on the map: Label, Owner (the owning account's current main), Scopes, Last used, Requests, Status, Revoke. Status is one of active, suspended until, expired, owner lost access, owner's account blocked.
- *Your tokens:* the viewer's own tokens on this map with Revoke, and a create form (label, scope checkboxes limited to what the map exposes, expiry of 30 days / 90 days / 1 year / never, default 90 days). Creating opens a one-time reveal dialog with the raw token, a copy button, and a statement that it will not be shown again. A link to the API reference sits next to the form.
- A blocked account sees a banner with the reason and when the block ends, and the create form is disabled.

**Account Settings dialog, new "API tokens" section.** Every token the account owns, across all maps (map name, label, status, last used, Revoke), plus the block banner. This is the one place a user can still see and revoke a token on a map whose API tab they can no longer reach.

**Admin.** `/admin/settings` gets the instance switch. `/admin/members` shows an "API blocked" badge on every character of a blocked account, and the row menu gets "Block API access" (reason required) and "Lift API block".

**Roles & Permissions tab** lists `api_manage` among the delegatable features.

---

## Stage 1 — Schema
**Mode:** Execute
**Status:** done — d35b03b2
**Goal:** Land every table, column and enum in the Data model section, with no behaviour.
**References:** `src/db/schema/ap/map.md`, `src/db/schema/ap/map_share.md`, `src/db/schema/ap/user.md`, `src/db/schema/ap/instance.md`, `src/db/schema/ap/enums.md`, `src/db/schema/ap/event_kind.md`, `src/types/index.md`
**Touches:** `src/db/schema/ap/enums.ts`, `src/db/schema/ap/map.ts`, `src/db/schema/ap/map_api_token.ts` (new), `src/db/schema/ap/user.ts`, `src/db/schema/ap/instance.ts`, `src/db/schema/index.ts`, `src/types/index.ts`, `src/db/migrations/0073_*` (generated with `pnpm db:generate`, plus a hand-written `.rollback.sql`), companions.
**Done when:** the migration applies to the dev DB and its rollback applies cleanly after it; the six `ap_event_kind` rows exist; `ApiScope`, `ApMapApiToken` and friends are exported from `src/types/index.ts`; `ci-verifier` is green.

## Stage 2 — Audit vocabulary
**Mode:** Execute
**Status:** done — b1aaacb2
**Goal:** Teach the event pipeline the six `api.*` kinds so later stages can commit them.
**References:** `src/lib/realtime/protocol.md`, `src/lib/map/applyEvent.md`, `src/lib/webhooks/formatters.md`, `src/lib/map/audit.md`; the `share.created` / `share.revoked` entries in each are the model.
**Touches:** `src/lib/realtime/protocol.ts`, `src/lib/map/applyEvent.ts`, `src/lib/webhooks/formatters.ts`, `src/lib/map/audit.ts`, `tests/unit/map-event-payload.test.ts`, `tests/unit/webhook-formatters.test.ts`, companions.
**Done when:** each kind has a Zod payload schema in the discriminated union and an entry in `MAP_EVENT_KINDS`; `describeMapEvent` renders each as an actorless, entity-naming sentence (the token label and its owner, the scopes added and removed) and the tests assert the exact strings; `applyEvent` folds `api.enabled` / `api.disabled` / `api.scopes_changed` into the map header's API state and treats the token kinds as no-ops; `api.token_revoked` and `api.disabled` count as destructive in `auditActorSummary`; the unit suite passes. (Stage 1 already added `api_manage` to `CAPABILITY_LABEL` in `formatters.ts`, because that record is exhaustive over `map_capability` and typecheck required it; review the phrase, don't re-add it.)

## Stage 3 — Token model and access decision
**Mode:** Execute
**Status:** done — f184fa4c
**Goal:** Resolve a bearer token to an allow or a coded refusal, per steps 3 to 5 and 7 of the pipeline.
**References:** `src/lib/integrations/token.md`, `src/lib/auth/rights.md`, `src/lib/auth/loginGate.md`, `src/lib/auth/blackout.md`, `src/lib/log/scrub.md`
**Touches:** `src/lib/userApi/token.ts` (new: generate, hash, parse), `src/lib/userApi/authorize.ts` (new: resolve, the pure decision function, the auth cache and its invalidation exports), `src/lib/log/scrub.ts`, `tests/unit/user-api-authorize.test.ts`, `tests/db/user-api-authorize.test.ts`, companions.
**Done when:** a table-driven unit test covers every row of the decision table plus effective-scope intersection; a DB test proves a live token turns into the right refusal when the owning account's main is kicked, when the main's corp changes so `canViewMap` fails, when the account's main is switched to a character that cannot view the map, when the account has no main, when the map's `api_enabled` flips, when a scope is removed from the map, and when the account is blocked; the invalidation exports make each explicit change visible to the next call without waiting for the TTL; the log scrubber redacts `apu_` tokens; neither module imports `server-only` if the job runner can reach it.

## Stage 4 — Rate limiting and the abuse ladder
**Mode:** Execute
**Status:** done — 65d9d0e0
**Goal:** Count requests, refuse the excess, and turn sustained refusal into suspension, revocation and account block.
**References:** `src/lib/userApi/authorize.md` (the decision record carries the token label and the owner's main id and name that the `api.token_*` payloads need), `src/lib/map/publicSnapshot.md`, `src/lib/log/clientErrorRate.md`, `src/lib/http/clientKey.md`, `src/lib/map/mutations/core.md`, `src/lib/metrics/registry.md`, `aperture.config.md`
**Touches:** `aperture.config.ts` (the rest of the `USER_API_*` block; Stage 3 already added `USER_API_AUTH_CACHE_TTL_MS` and `USER_API_AUTH_CACHE_MAX_ENTRIES` under a "User API" heading in `aperture.config.md`), `src/lib/userApi/rateLimit.ts` (new: IP, token, account and global windows, failed-auth IP block, hot-window tracking), `src/lib/userApi/abuse.ts` (new: strike persistence, suspend, revoke, account block, each committing its event), `src/lib/userApi/usage.ts` (new: batched usage flush), `src/lib/metrics/registry.ts`, unit and DB tests, companions.
**Done when:** unit tests with an injected clock cover each limiter, the hot-window and strike arithmetic, strike decay, and the IP block steps; a DB test walks one token through strike 1, 2 and 3 and asserts `suspended_until`, `revoked_reason='abuse'`, the account's `api_blocked_until` (7 days first time, NULL when a prior block began inside the repeat window), and exactly one `ap_map_event` per transition; each transition calls the Stage 3 invalidation (`invalidateUserApiToken` on suspend and revoke, `invalidateUserApiAccount` on the block) so the very next request sees it; every in-process map is shown by test to be empty after its window rolls; the new Prometheus series appear in the registry test.

## Stage 5 — Read projections and cache
**Mode:** Execute
**Status:** done — 8e6a9ffb
**Goal:** Produce the five non-kill resources as stable DTOs behind a coalescing cache.
**References:** `src/lib/userApi/authorize.md` (source of the owning account's `BlackoutViewer`), `src/lib/map/loadMap.md`, `src/lib/map/loadPublicMap.md` (a second projection over the same tables), `src/lib/map/publicSnapshot.md`, `src/lib/map/connectionMassLog.md`, `src/lib/auth/blackout.md`, `src/app/(admin)/actions/blackout.md`
**Touches:** `src/lib/userApi/projection.ts` (new), `src/lib/userApi/cache.ts` (new; `USER_API_PROJECTION_TTL_MS` already exists in `aperture.config.ts`, add only an LRU size constant beside it), `src/lib/map/loadMap.ts` only if a viewer-independent loader has to be split out of `loadMapForView`, `src/lib/map/connectionMassLog.ts` (a map-wide list), `src/app/(admin)/actions/blackout.ts` (clear the API caches where it already clears public snapshots, including Stage 3's `clearUserApiAuthCache`, because the resolved token record carries the owning account's `BlackoutViewer` in `record.access.blackout`), `src/types/index.ts`, tests, companions.
**Done when:** a DB test loads each resource for a seeded map and asserts the visibility predicates match `loadMapForView` (a hidden system, a dormant connection and an orphan edge are all absent); a key-walking test asserts no DTO contains `userId` at any depth and that `map` carries no intel-notes text; with Blackout on, `pilots` for an uncleared creator holds only that account's pilots and `mass_log` is `hidden`, while a cleared creator gets both in full; concurrent misses for one key perform one load; the Blackout on and off actions empty the projection cache and the Stage 3 auth cache.

## Stage 6 — HTTP surface
**Mode:** Execute
**Status:** done — 8abaabf3
**Goal:** Serve the six non-kill endpoints through one wrapper that runs the whole pipeline in the contracted order.
**References:** `src/app/api/public/[token]/snapshot/route.md`, `src/lib/metrics/httpInstrumentation.md`, plus the Stage 3, 4 and 5 companions.
**Touches:** `src/lib/userApi/handler.ts` (new: the wrapper, CORS and `OPTIONS`, envelope, ETag, rate-limit headers; step 2 is `checkUserApiIp` (a refusal is 429 `rate_limited` with its `retryAfterSec`); steps 3 to 5 are one `authorizeUserApiBearer` call, and every 401 the wrapper returns goes to `recordUserApiAuthFailure(ip)`; step 6 is `consumeUserApiRequest(record.token.id, record.account.userId)`, whose `limit` / `remaining` / `resetSec` feed the `RateLimit-*` headers; a `token_suspended` decision calls `noteUserApiSuspendedRequest(tokenId)`; whenever either of those reports a strike, fire `applyUserApiStrike(tokenId)` without awaiting it (it never throws); step 7 is `checkUserApiScope`; every request that passes step 6 calls `recordUserApiUsage(tokenId)`; every response calls `recordUserApiRequest(endpoint, outcome)`; `/api/v1/token` reports `effectiveUserApiScopes`; step 8 is `getUserApiProjection(record.map.id, resource, record.access.blackout)` (Stage 5), answering 304 when `If-None-Match` matches `entry.etag` and otherwise sending `entry.body` unchanged, since it is already the whole success envelope; `mass-log?connection=<id>` filters `entry.payload.data` by `connectionId` and serialises its own envelope and ETag; the `mass-log` endpoint maps to resource and scope `mass_log`; tests reset state with `__resetUserApiRateLimit` / `__resetUserApiUsage` / `clearUserApiProjections`), `src/app/api/v1/{token,map,signatures,pilots,notes,mass-log}/route.ts` (new, each a few lines), `tests/unit/user-api-route-coverage.test.ts` (new static scan), `tests/integration/user-api.test.ts` (new), companions. This is more files than a stage should carry; it is acceptable only because six of them are near-identical one-call handlers. If the wrapper grows past that, split the routes into their own stage.
**Done when:** the static scan fails if any `route.ts` under `src/app/api/v1` does not export through the wrapper; the integration test covers 200, 304 on a matching `If-None-Match`, 401 for a missing, malformed and revoked token, each 403 code, 429 with `Retry-After`, and 404 for the whole group when the instance switch is off; a test asserts ordering by showing a request for an ungranted scope still consumes rate budget; no handler reads a cookie.

## Stage 7 — Kills scope
**Mode:** Execute
**Status:** done — ac9ab9b7
**Goal:** Serve kills in on-map systems from the local killmail cache, with no upstream call on the request path.
**References:** `src/db/schema/universe/killmail.md`, `src/lib/integrations/zkbFeed.md`, `src/lib/integrations/zkb.md`, `src/lib/map/killboard.md`
**Touches:** `src/db/schema/universe/killmail.ts` and migration `0074_*` (`solar_system_id` as a stored generated column over the body, an index on `(solar_system_id, killmail_time DESC)`, and a nullable `total_value`), `src/lib/integrations/zkbFeed.ts` (persist every kill that correlates to at least one active map, whatever its age, `ON CONFLICT DO NOTHING`), `src/lib/map/killboard.ts` (write `total_value` on its cache-aside insert), `src/lib/userApi/projection.ts` (a `kills` case in `loadUserApiProjection`), `src/types/index.ts` (`kills` joins `UserApiResource` and `UserApiProjectionData`), `src/lib/userApi/handler.ts` (a `serveUserApiKills` beside `serveUserApiMassLog`), `src/app/api/v1/kills/route.ts` (exported through `userApiRoute('kills', 'kills', serveUserApiKills)`, the shape `tests/unit/user-api-route-coverage.test.ts` enforces), tests, companions. The projection cache keys `kills` by map alone, so project the whole 7-day floor once and apply `since` and `limit` in the serve function over `entry.payload.data`, the way `serveUserApiMassLog` applies `?connection=`, with its own envelope and ETag, rather than letting query parameters multiply cache keys. The wrapper has no 400 path and `UserApiErrorCode` no bad-request code, so clamp an out-of-bounds or unparseable `since` / `limit` to its default or bound rather than refusing. Route tests that count requests must pin `Date` the way `tests/integration/user-api.test.ts` does (see Notes).
**Done when:** the existing R2Z2 fixture run through the feed leaves a `universe_killmail` row that `killmailSchema` parses; a feed kill whose body fails the schema is skipped for persistence and still flashes; a kill in a system on no active map is not persisted; the endpoint returns only kills whose system is visible on the token's map, honours `since` and `limit` and their bounds; a test with the zKB and ESI clients stubbed to throw proves the endpoint never calls either.

## Stage 8 — Map management and the API tab
**Mode:** Execute
**Status:** done — 77aa89bf
**Goal:** Give managers the switch and scope controls, and give viewers mint, list and revoke, inside Map Settings.
**References:** `src/app/(app)/actions/mapShares.md`, `src/components/map/manage/MapSharePanel.md`, `src/components/dialogs/MapSettingsDialog.md`, `src/components/map/manage/MapRolesForm.md`, `src/app/(app)/actions/mapRoles.md`
**Touches:** `src/app/(app)/actions/mapApi.ts` (new: read state, update settings, create token, revoke token), `src/components/map/manage/MapApiPanel.tsx` (new), `src/components/dialogs/MapSettingsDialog.tsx`, `src/components/map/manage/MapRolesForm.tsx`, whatever passes map API state into the dialog, tests, companions. The map's `apiEnabled` / `apiScopes` already ride `MapViewData.map` (loaded by `loadMapForView`, kept live by `applyEvent` from the `api.*` settings events, Stage 2), so the tab's visibility and the create form's scope list can read them from the canvas view data instead of a separate fetch. The `api.token_revoked` / `api.token_suspended` payloads take `ownerCharacterId` as a number and `ownerName`, both nullable for an account with no main.
**Done when:** action tests show settings changes need `api_manage` and a title-delegated holder passes; minting is refused when the map or the instance is off, when the account is blocked, when a requested scope is not exposed, and at either token cap; the mint result is the only place the raw token appears and no event payload contains it; revoking your own token works, revoking someone else's needs `api_manage`, and an unknown id and a forbidden id return the identical message; every settings change (`invalidateUserApiMap`) and revoke (`invalidateUserApiToken`) invalidates the Stage 3 cache; minting uses `generateUserApiToken`, refuses an instance whose switch is off via `isUserApiInstanceEnabled` (`src/lib/userApi/instance.ts`, Stage 6), refuses a blocked account via `isUserApiAccountBlocked`, and reads the caps from `USER_API_MAX_TOKENS_PER_ACCOUNT_PER_MAP` / `USER_API_MAX_TOKENS_PER_ACCOUNT` (Stage 4 added them to `aperture.config.ts`); a component test covers the three panel states (viewer, manager, blocked account) and the one-time reveal.

## Stage 9 — Account token list
**Mode:** Execute
**Status:** done — 75c47097
**Goal:** Show an account every token it owns, with revoke and block status, in Account Settings.
**References:** `src/components/account/AccountSettingsDialog.md`, `src/app/(app)/actions/account.md`, `src/lib/session.md`
**Touches:** `src/app/(app)/actions/mapApi.ts`, `src/app/(app)/actions/account.ts` (the set-main action calls `invalidateUserApiAccount`, since a token is judged by the account's current main), `src/components/account/AccountSettingsDialog.tsx` (or a small child component it embeds), the layout plumbing that feeds the dialog, tests, companions.
Stage 8 left reusable pieces in `mapApi.ts`: `revokeMapApiToken` already lets the owning account revoke its own token (reason `creator`) with no view check, so reuse it rather than adding a second revoke; the internal `selectTokenRows` / `toListItems` / `statusOf` / `blockOf` helpers compute `UserApiTokenListItem` rows and `UserApiAccountBlock`, but `selectTokenRows` does not join `ap_map`, so the account list needs the map's name, `deleted_at` and `api_enabled` added, and `UserApiTokenStatus` has no value for "this map's API is off" (add one, or show the map's switch beside the status). The block banner is a private `BlockBanner` inside `MapApiPanel.tsx`; extract it rather than restating its copy.
**Done when:** the list includes tokens on maps the account can no longer view and tokens on maps whose API is off, each with its computed status; revoke works for those too and commits `api.token_revoked` with reason `creator`; changing the account's main invalidates the Stage 3 cache for the account; the block banner shows the reason and end time for a timed block and "until an admin lifts it" for an indefinite one.

## Stage 10 — Operator controls and documentation
**Mode:** Execute
**Status:** todo
**Goal:** Give the operator the instance switch and the block and lift actions, and publish the consumer reference.
**References:** `src/app/(admin)/actions/settings.md`, `src/app/(admin)/actions/members.md`, `src/components/admin/MemberActionsMenu.md`, `src/lib/auth/members.md`, `src/app/(public)/privacy/page.md`
**Touches:** `src/app/(admin)/actions/settings.ts`, `src/app/(admin)/actions/members.ts`, `src/lib/auth/members.ts`, `src/components/admin/MemberActionsMenu.tsx`, the `/admin/settings` and `/admin/members` pages, `src/app/(public)/privacy/page.tsx`, `docs/reference/user-api.md` (new), tests, companions.
**Done when:** all three actions are `isAdmin`-gated and tested; a manual block is indefinite and requires a reason; a lift ends the block and keeps `api_blocked_at`; block and lift invalidate the Stage 3 cache for that account (`invalidateUserApiAccount`); the instance-switch action calls `invalidateUserApiInstanceSwitch()` (`src/lib/userApi/instance.ts`) after its write commits, and the 404 case in `tests/integration/user-api.test.ts`, which flips `ap_instance.user_api_enabled` directly today, flips it through that action instead and still passes; the reference documents auth, every endpoint and field, every error code (and that the instance-switch 404 is a bare `{ ok: false, error }` with no code), the limits and the `RateLimit-*` headers (present from the rate-limit step onward, so absent on 401s and on the IP-gate 429; `RateLimit-Remaining` is the smaller of the token's and the account's budget), CORS, ETag / 304, the ladder, the Blackout behaviour and the kills coverage caveat (see the Stage 7 note), that `kills` clamps an out-of-range or unparseable `since` / `limit` to its bound or default rather than refusing (`since` defaults to 24 hours back and floors at 7 days; `limit` defaults to and caps at 200, minimum 1), and contains no em-dashes; the privacy page states that map managers can let members export map data, including pilot names and locations, to their own tools. The Map Settings API tab already links to `https://github.com/<GITHUB_CHANGELOG_REPO>/blob/master/docs/reference/user-api.md` (`MapApiPanel.tsx`), so the reference must land at exactly `docs/reference/user-api.md`, and the link resolves only once it reaches `master`.

---

## Manual verification
_(worked by the user once, after the run; the plan is not complete until it passes)_
- **Stage 6** — from a terminal, hit each endpoint with a real token and confirm the payloads read sensibly; repeat one with the returned ETag and get a 304.
- **Stage 6** — from a page on a different origin, `fetch` an endpoint with the bearer header and confirm the browser allows it.
- **Stage 6** — run a tight loop against one token: 429s with `Retry-After` first, a 15-minute suspension after about three minutes, and an "API token suspended" line in the map's audit log naming the token and its owner.
- **Stage 7** — with `ZKB_FEED_ENABLED` on, after a real kill lands in a system on the map, `/api/v1/kills` returns it without anyone having opened the killboard sidebar.
- **Stage 8** — as a manager, enable the API with two scopes; as a plain member in a second browser, see the tab appear, mint a token, and confirm the unchecked scopes are not offered.
- **Stage 8** — untick a scope as the manager and confirm the member's very next request for it is a 403; switch the API off and confirm the same for everything.
- **Stage 8** — delegate `api_manage` to a corp title and confirm a holder of that title, who is not a Director, gets the manager block.
- **Stage 8** — confirm the `api.*` lines read well in the Discord history webhook.
- **Stage 5** — turn Blackout on: an uncleared member's token returns only their own pilots and a hidden mass log; a cleared member's token is unchanged.
- **Stage 9** — have a test account's main leave the corp and confirm the account's token shows as "lost access" in Account Settings and can still be revoked there.
- **Stage 8** — on an account with two characters, confirm the token list and the caps are the same whichever character minted, and that the manager's list shows the main as the owner.
- **Stage 10** — block an account by hand: the banner appears, minting is disabled, existing tokens answer `account_blocked`; lift it and they work again.
- **Stage 10** — read the privacy page wording and the API reference as a stranger would.

## Notes
_(appended by executing sessions; non-obvious findings only)_
- **Stage 1** — a Drizzle `bigint({ mode: 'bigint' }).default(0n)` crashes `drizzle-kit generate` (`JSON.stringify` cannot serialise a BigInt). `ap_map_api_token.request_count` uses ``.default(sql`0`)`` instead; do the same for any future bigint default.
- **Stage 2** — `MapAuditBrowser.tsx` keeps its own client-side copies of the per-category kind lists and the destructive set (it avoids importing the protocol runtime into the client bundle). Typecheck does not force a new kind into them, so a kind missing there silently drops out of the "Access" chip and "Deletions only" filters. `audit.ts`'s `kindCategory` likewise needs an explicit mapping for any prefix that is not itself a category (`share`, `api` both map to `access`).
- **Stage 2 (review)** — constraints on the committers of `api.*` events, which `applyEvent` and `describeMapEvent` rely on: `api.token_suspended.until` must be a `toISOString()` value (the formatter slices it and labels it UTC); Stage 8 must never commit an `api.scopes_changed` with both lists empty (it renders as a vague fallback line and posts nothing to Discord); and a save that disables the API emits only `api.disabled`, so the client's `apiScopes` go stale if the same save also edits scopes. Stage 8 should either refuse scope edits in a disabling save or not prefill the manager's checkboxes from `MapViewData.map.apiScopes` while the API is off.
- **Stage 3** — the resolved token record carries the owning account's `BlackoutViewer` (`record.access.blackout`), so the pilots and mass-log projections read Blackout standing from it rather than querying again, and a cleared-list edit reaches the API within the auth TTL like any other observed change. `access` is only evaluated for a token that is not already dead at resolve time; `decideUserApiAccess` fails closed (`access_lost`) if it is ever null on a live token.
- **Stage 3** — `isLoginAllowed` carries the bootstrap side effect (on a completely unconfigured instance it grants the caller admin). The API path calls it exactly as the session re-gate in `auth.ts` does, so the exposure is identical, but a test that runs the decision against a dev DB with zero owners, zero instance grants and no admin would mint a grant. The DB test seeds an instance owner for that reason.
- **Stage 3** — `scrubContext` redacts `apu_` tokens in persisted `ap_error_log.context`, but the logger's `message` argument and the pino stdout line are not scrubbed. No call site logs a raw token today; keep it that way in Stages 4 and 6 (log the token id, never the header).
- **Stage 3 (review)** — a refusal test proves its gate only if every other gate passes: `access_lost` is reached by `canViewMap` *or* the login gate, so a corp-move or main-switch case must keep the target character login-allowed (both test corps are instance owners) and assert `mainCanView: false` with `mainLoginAllowed: true`. Stages 4 and 6 should isolate their refusal codes the same way.
- **Stage 3 (review)** — the auth-cache invalidation exports must be called **after** the change commits, never inside the transaction: a load that starts between the invalidation and the commit reads the old row under the new generation and caches a stale allow for up to the TTL. This binds `abuse.ts` (Stage 4), `mapApi.ts` (Stages 8, 9), the set-main action (Stage 9) and the block/lift actions (Stage 10).
- **Stage 4** — the design left two gaps, filled as follows. (1) A strike 3 on an account that is already blocked revokes the token and leaves the standing block untouched. Re-blocking would read the block just set by a sibling token's strike 3 as a "previous block inside the repeat window" and make a single offence indefinite. (2) An IP's escalation step is remembered for the longest `USER_API_IP_BLOCK_STEPS_MS` step after its block ends, then forgotten; that is what bounds the IP-block map.
- **Stage 4** — all limiter counters share one window aligned to multiples of `USER_API_RATE_WINDOW_MS`, so `Retry-After` / `RateLimit-Reset` is the same for every client in a window and a hot window is exactly one aligned minute. A refused request consumes no budget, so a client that stops hammering is served again as soon as the window rolls.
- **Stage 4 (review)** — a test proves an auth-cache invalidation only if the record is cached within `USER_API_AUTH_CACHE_TTL_MS` before the change and re-read inside that entry's life; stepping the injected clock past the TTL passes with the call deleted. An account invalidation also drops that account's token entries, so a token invalidation needs a case with no account invalidation beside it. Binds the invalidation tests of Stages 8, 9 and 10.
- **Stage 4 (review)** — `consumeUserApiRequest`'s `limit` / `remaining` describe the token's own budget only, so when the account cap is what binds, `RateLimit-Remaining` can read above 0 while the next request is refused. Stage 6 should derive the headers from whichever cap binds (or report the smaller remaining). Separately, every IP limit keys off the head of `X-Forwarded-For`, which a client can rotate unless the proxy overwrites it; the Stage 10 reference should tell operators to terminate XFF at their proxy.
- **Stage 5** — the projections share their visibility predicates with `loadMapForView` by construction: `loadMap.ts` exposes the viewer-independent `loadVisibleMapSystems` / `loadVisibleMapConnections` / `loadMapNotes` that `loadMapForView` itself composes, rather than restating the queries the way `loadPublicMap.ts` does. Any later projection, such as Stage 7's kills filter to on-map systems, should read through them too.
- **Stage 5** — the cached `etag` hashes the payload, not the body, because `generatedAt` changes on every reload; an unchanged map keeps its ETag across TTL refreshes, which is what makes `If-None-Match` worth sending at a 5 s TTL.
- **Stage 5** — `tests/db/user-api-projection.test.ts` flips `ap_instance.blackout_since` like `admin-blackout` and `blackout-read-paths` do; run in parallel with either, `admin-blackout`'s switch cases fail on the shared singleton. Triage those three in isolation.
- **Stage 5 (review)** — for Stage 6: the `mass-log?connection=` filtered envelope must carry `hidden: true` through when the cached payload is hidden, or an uncleared owner reads a withheld log as an empty one. Also, only the `map` projection refuses a soft-deleted map (it throws, a 500 if unhandled); the other four serve a just-deleted map until the auth record's TTL lapses, since map soft-delete invalidates neither cache. Stage 6's wrapper should turn the `map` throw into the same 401 as any dead token, and calling `invalidateUserApiMap` from map delete would close the window outright.
- **Stage 6** — the design left three gaps, filled as follows. (1) `RateLimit-*` headers ride only responses from step 6 onward: a 401, a decide-step 403 or an IP-gate 429 has no token budget to report, and quoting the IP cap there would read as the token's. (2) The instance-switch 404 is a bare `{ ok: false, error }` and is not tallied in `user_api_requests_total` (no outcome label fits, and the API is off); CORS preflights are not tallied either. (3) The switch is read through a cached reader in `src/lib/userApi/instance.ts`, a file the stage did not list, so Stages 8 and 10 import it from there rather than from the wrapper.
- **Stage 6** — the limiter's window is aligned to wall-clock minutes, so a test that counts requests on the real clock flakes whenever it straddles a minute boundary. `tests/integration/user-api.test.ts` pins time with `vi.useFakeTimers({ toFake: ['Date'] })` at a window start; faking only `Date` leaves `setTimeout` and the pg pool on real timers.
- **Stage 6** — map soft-delete still invalidates neither cache. The wrapper turns the `map` projection's throw into a 401 and drops the map's auth records, but `signatures`, `pilots`, `notes` and `mass-log` keep serving a just-deleted map until the auth TTL lapses. Calling `invalidateUserApiMap` from the map-delete action would close that; no stage owns it yet.
- **Stage 6 (review)** — `RateLimit-*` headers are absent not only on 401s and the IP-gate 429 but also on the decide-step 403s (`account_blocked`, `token_suspended`, `api_disabled`, `access_lost`); the Stage 10 reference must say so. Two gaps still have no owning stage: map soft-delete calls neither `invalidateUserApiMap` nor `clearUserApiProjections`, so four resources keep serving a deleted map for up to the auth TTL; and a non-GET method gets Next's default 405 with no CORS headers, even while the instance switch is off.
- **Stage 7** — what `kills` can cover, for the Stage 10 caveat: the feed is live-only (cursor seeded at boot, no backfill) and runs only with `ZKB_FEED_ENABLED`; it persists a kill only if the system was in its active-system index at that moment (rebuilt every `ZKB_FEED_INDEX_REFRESH_MS`), so a system added to a map has no history from before it was added, except whatever the in-app killboard cached when someone opened it. Rows cached before migration 0074, and any killboard row whose zKB list entry had no value, have `totalValue: null`. `KILLMAIL_CACHE_RETENTION_DAYS` (30) exceeds the 7-day floor, so retention never trims the window. `kills` also joins the resources that keep serving a just-soft-deleted map until the auth TTL lapses (the unowned gap in the Stage 6 notes).
- **Stage 7 (review)** — for the Stage 10 reference: `kills` has no paging past its 200 newest within 7 days, so a map holding a busy k-space system cannot reach older kills; and `since` should be documented as ISO 8601 **with an offset**, since `Date.parse` reads an offset-less value as server-local time.
- **Stage 8** — the Stage 2 stale-scopes gap is closed by refusal: `updateMapApiSettings` rejects a save that turns the API off and also changes scopes, and the panel resets and disables the scope checkboxes when the switch is unticked. Off-to-off scope edits are still accepted as `api.scopes_changed`.
- **Stage 8** — token lists include expired, non-revoked tokens (the design says "live" but its status list includes "expired"); the caps count only live ones. `lost_access` is computed per (account, map) with `canViewMap` plus `isLoginAllowed` on the main, so listing carries the same bootstrap exposure the Stage 3 note describes, and a DB test listing tokens needs an instance owner seeded.
- **Stage 8 (review)** — the Done when never required minting to be judged by the account's main, so the session character's view alone passed it. The session can sit on an alt (a set-main mid-session, or an inactive stored main), so any action that grants or lists the account's API access must run the main's `canViewMap` + login gate itself, not just `requireMapView`; Stage 9's list already does through `statusOf`.
- **Stage 8** — settings and revoke run their own `db.transaction` with `commitMapEvent` in joined mode, so the auth invalidation and `enqueueWebhookDispatch` both follow the commit; joined mode skips the webhook enqueue, so a later committer taking that route must re-fire it the same way.
- **Stage 8 (review)** — `MapApiPanel` renders the one-time `RevealDialog` inside the panel's non-error branch, so if the reload that follows a successful mint fails, the panel swaps to its error text and the raw token is lost unrecoverably. Not a Done-when gap; worth fixing (render the reveal outside the error/loading early returns) when Stage 9 extracts the block banner from the same file.
- **Stage 9** — `UserApiTokenStatus` gained `map_deleted` (checked right after `expired`, both 401s in the decision) and `api_disabled` (after `suspended`, where the decision's `api_disabled` row sits). Tokens on a soft-deleted map stay listed and revocable in Account Settings, because an admin restore brings the map, and so the token, back to life. `api_disabled` also shows in the map tab's lists, so a manager who switches the API off sees every token there read "API off on this map".
- **Stage 9** — the account section fetches `getAccountApiTokens` when Account Settings opens (the section sits inside the dialog's content, which mounts only while open), so no layout plumbing was added; `CharacterPanel` mounts the dialog on every page and a server-rendered list would cost a query per page load.
- **Stage 9** — the Stage 8 review's `RevealDialog` fix landed: the reveal renders outside `MapApiPanel`'s loading and error branches, with a component test for a failed reload after a mint.
