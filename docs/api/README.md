# Aperture user API reference

The user API lets a member of a map read that map's data from their own tools: a Discord bot, a spreadsheet, an overlay, a script. It is read-only. Every request is authorised by a per-map bearer token that a member creates in the map's settings.

This page is the consumer contract for `/api/v1/*`. Everything here describes how the API behaves today.

## Contents

- [Getting a token](#getting-a-token)
- [Authentication](#authentication)
- [Responses](#responses)
- [Endpoints](#endpoints)
- [Errors](#errors)
- [Rate limits](#rate-limits)
- [Caching, ETag and 304](#caching-etag-and-304)
- [Abuse handling](#abuse-handling)
- [Blackout](#blackout)
- [CORS](#cors)
- [Notes for operators](#notes-for-operators)

## Getting a token

Three switches must all be on before a token works:

1. **The instance.** The operator of the Aperture deployment can turn the whole API off. While it is off every `GET`, `HEAD` and `OPTIONS` request to `/api/v1/*` answers 404.
2. **The map.** Each map's API is off until one of its managers turns it on in **Map Settings, API**. The managers also choose which [scopes](#scopes) the map exposes.
3. **The token.** Any member who can view the map can then create a token in the same tab. A token is created with a label (1 to 60 characters), the scopes it may read (a subset of what the map exposes), and an expiry of 30 days, 90 days, 1 year or never.

The raw token is shown exactly once, when it is created. Aperture stores only a hash of it and cannot show it again. If you lose it, revoke it and create a new one.

A token belongs to your account, not to one of your characters, and it is judged by your account's main character. If you change your main, your tokens are judged by the new one. One account may hold at most 3 live tokens on one map and 20 across all maps.

You can see and revoke every token you own, on every map, in **Account Settings, API tokens**. That list keeps tokens on maps you can no longer open, so you can always revoke them.

### Scopes

| Scope | Endpoint | What leaves the map |
|---|---|---|
| `map` | `/api/v1/map` | The map's header, its visible systems and its connections. |
| `signatures` | `/api/v1/signatures` | Signatures in visible systems. |
| `pilots` | `/api/v1/pilots` | Online tracked pilots: character names, their mains, their systems and ships. |
| `notes` | `/api/v1/notes` | Free-standing map notes and each system's intel notes. |
| `mass_log` | `/api/v1/mass-log` | The per-jump mass log of the map's connections, including the name of each pilot who jumped. |
| `kills` | `/api/v1/kills` | Kills in the map's systems from Aperture's local killmail cache. |

A request can read a scope only while it is in **both** the token's scopes (fixed when the token was created) and the map's exposed scopes (which managers can change at any time). `GET /api/v1/token` reports the token's scopes and that intersection, the scopes you can read right now. It does not list the map's exposed scopes.

## Authentication

Send the token in the `Authorization` header with the `Bearer` scheme:

```
Authorization: Bearer apu_...
```

There is no query-string or cookie alternative. Tokens start with `apu_`, which also lets secret scanners recognise one that has leaked. Treat a token like a password: anyone holding it reads what it can read.

The token alone selects the map. No endpoint takes a map id.

A token keeps working only while all of these hold:

- it is not revoked and has not expired, and its map has not been deleted;
- the owning account is not [blocked](#abuse-handling) from the API;
- the token is not [suspended](#abuse-handling);
- the map's API is on;
- the owning account has a main character, that main can still view the map, and that main can still sign in to this instance.

The last condition means a token stops working when its owner leaves the corporation, is kicked or banned, or otherwise loses access to the map, without anyone having to revoke it.

**How fast changes apply.** Deliberate actions (revoking a token, a manager changing the map's API settings, an admin blocking or lifting a block, the Blackout switch) apply to the very next request. Changes Aperture only observes, such as a pilot leaving their corporation or a kick or ban, apply within 10 seconds.

## Responses

All endpoints are `GET` and return JSON.

**Success:**

```json
{ "ok": true, "data": { ... }, "generatedAt": "2026-11-21T18:04:05.123Z" }
```

`generatedAt` is when the server built the data. `mass-log` can add `"hidden": true` (see [Blackout](#blackout)).

**Failure:**

```json
{ "ok": false, "error": "This map's API is turned off.", "code": "api_disabled" }
```

`code` is a stable machine-readable string from the [error table](#errors); branch on it. `error` is human-readable prose and may change.

The one exception is the 404 the API answers while the operator has turned it off: it is a bare `{ "ok": false, "error": "Not found." }` with **no `code`**.

**Conventions:**

- Large ids (map, system, connection, signature, character, corporation, alliance, killmail) are **strings**, because they can exceed the integer range JavaScript represents exactly. EVE solar-system ids and type ids are numbers.
- Timestamps are ISO 8601 strings in UTC.
- A field documented as nullable is present with the value `null`, never omitted.
- No response carries any Aperture account id.

**Headers on every response:** `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, and the [CORS](#cors) headers. Rate-limit headers are described under [Rate limits](#rate-limits).

## Endpoints

### `GET /api/v1/token`

No scope needed. Describes the token you sent.

| Field | Type | Meaning |
|---|---|---|
| `map.id` | string | The token's map. |
| `map.name` | string | |
| `scopes.granted` | string[] | The scopes the token was created with. |
| `scopes.effective` | string[] | The granted scopes the map still exposes. These are the scopes you can read right now. |
| `expiresAt` | string or null | When the token expires; null for never. |
| `rateLimit.perToken` | number | Requests per window for this token. |
| `rateLimit.perAccount` | number | Requests per window shared by every token the owning account holds. |
| `rateLimit.windowSeconds` | number | The window length. |

### `GET /api/v1/map`

Scope `map`. The map header, its visible systems, and its confirmed connections whose two ends are both visible. Hidden systems and unconfirmed connections are never included. Intel-notes text is not included here; it belongs to [`notes`](#get-apiv1notes).

`data.map`:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `scope` | string | `wh`, `k_space`, `none` or `all`. |
| `type` | string | `private`, `corp` or `alliance`. |
| `homeMapSystemId` | string or null | The `systems[].id` of the map's home system. |

`data.systems[]`:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The system's id on this map. Connections, signatures and notes refer to it. |
| `systemId` | number | EVE solar-system id. |
| `name` | string | EVE system name. |
| `alias` | string or null | The map's alias for the system. |
| `tag` | string or null | The map's tag for the system. |
| `status` | string | `unknown`, `friendly`, `occupied`, `hostile`, `empty` or `unscanned`. |
| `security` | string or null | Security label, for example `C3`, `C13`, `H`, `L` or `0.0`. |
| `trueSec` | number or null | True security status. |
| `effect` | string or null | Wormhole system effect. |
| `regionName` | string | |
| `constellationName` | string | |
| `statics` | `{ label, typeId }[]` | The system's static wormholes. |
| `tradeHub` | `{ name, jumps }` or null | Nearest trade hub and its distance in jumps. |
| `locked` | boolean | Whether the system is locked on the map. |
| `lockedByCharacterId` | string or null | |
| `lockedByName` | string or null | |
| `rallyAt` | string or null | When a rally point was set on the system. |
| `positionX`, `positionY` | number | Position on the map canvas. |

`data.connections[]`:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Connection id. `mass-log?connection=` takes this. |
| `source`, `target` | string | The `systems[].id` of each end. |
| `scope` | string | `wh`, `stargate`, `jumpbridge` or `abyssal`. |
| `massStatus` | string | `fresh`, `reduced` or `critical`. |
| `jumpMassClass` | string or null | Largest ship that fits: `s`, `m`, `l` or `xl`. |
| `eolStage` | string | `none`, `eol`, `critical` or `expired`. |
| `eolAt` | string or null | When the connection entered its end-of-life stage. |
| `preserveMass` | boolean | |
| `isRolling` | boolean | |
| `isStatic` | boolean | |
| `sourceBubbled`, `targetBubbled` | boolean | Whether each end is marked as bubbled. |
| `createdAt` | string | |

### `GET /api/v1/signatures`

Scope `signatures`. Every signature in a visible system.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | |
| `mapSystemId` | string | The `systems[].id` of the system the signature is in. |
| `systemId` | number | EVE solar-system id. |
| `systemName` | string | |
| `connectionId` | string or null | The connection this wormhole signature is linked to. |
| `sigId` | string | The in-game signature id, for example `ABC-123`. |
| `groupKey` | string or null | `combat`, `relic`, `data`, `gas`, `wormhole`, `ore` or `ghost`. |
| `classKind` | string or null | `signature` or `anomaly`. |
| `activityOverride` | string or null | `combat` or `exploration` when a member set it by hand. |
| `typeId` | number or null | |
| `wormholeCode` | string or null | Wormhole type code, for example `K162`. |
| `name` | string or null | |
| `description` | string or null | |
| `eolStage` | string | `none`, `eol`, `critical` or `expired`. |
| `expiresAt` | string | |
| `createdAt`, `updatedAt` | string | |

### `GET /api/v1/pilots`

Scope `pilots`. Every online pilot tracked on this map and their current system, whether or not that system is on the map: a pilot staging in k-space or sitting in another chain is listed with that location. Filtered to what the token's owner may see (see [Blackout](#blackout)).

| Field | Type | Meaning |
|---|---|---|
| `characterId` | string | |
| `characterName` | string | |
| `mainCharacterId` | string or null | The pilot's main character. |
| `mainCharacterName` | string or null | |
| `systemId` | number | EVE solar-system id. |
| `systemName` | string or null | |
| `systemSecurity` | string or null | Security label, as in `systems[].security`. |
| `systemTrueSec` | number or null | |
| `shipTypeId` | number or null | |
| `shipTypeName` | string or null | |
| `shipClass` | string or null | Ship class, for example `frigate`, `cruiser`, `battleship`. |
| `shipName` | string or null | The ship's own name. |
| `locationAt` | string | When this location was last observed. |

### `GET /api/v1/notes`

Scope `notes`.

`data.notes[]`, every free-standing note on the map:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `content` | string or null | |
| `severity` | string | `neutral`, `green`, `yellow` or `red`. |
| `locked` | boolean | |
| `positionX`, `positionY` | number | Position on the map canvas. |
| `createdByCharacterId`, `createdByName` | string or null | |
| `lastEditedByCharacterId`, `lastEditedByName` | string or null | |
| `createdAt`, `updatedAt` | string | |

`data.systemNotes[]`, one entry for each visible system that has intel notes:

| Field | Type | Meaning |
|---|---|---|
| `mapSystemId` | string | The `systems[].id` of the system. |
| `systemId` | number | EVE solar-system id. |
| `systemName` | string | |
| `intelNotes` | string | The notes text. |

### `GET /api/v1/mass-log`

Scope `mass_log`. One entry per jump through a confirmed connection whose two ends are visible, newest first. Entries are recorded by Aperture's own location tracking.

Optional query parameter: `connection=<id>`, a `connections[].id`, to return only that connection's jumps. An id that matches nothing returns an empty list.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | |
| `connectionId` | string | |
| `sourceSystemId`, `targetSystemId` | number | EVE solar-system ids of the connection's two ends. |
| `characterId` | string or null | The pilot who jumped. |
| `characterName` | string or null | |
| `shipTypeId` | number or null | |
| `shipTypeName` | string or null | |
| `mass` | number | Mass of this jump, in kg. |
| `cumulativeMass` | number | Total logged mass through the connection up to and including this jump, in kg. |
| `jumpedAt` | string | |

While Blackout hides the log from the token's owner the response is `{ "ok": true, "data": [], "hidden": true, "generatedAt": ... }`. Check `hidden` before reading an empty list as "no jumps".

### `GET /api/v1/kills`

Scope `kills`. Kills in the map's visible systems, newest first.

Optional query parameters:

| Parameter | Default | Bounds |
|---|---|---|
| `since` | 24 hours ago | An ISO 8601 time **with an offset** (for example `2026-11-21T12:00:00Z`). Values earlier than 7 days ago are treated as 7 days ago; values in the future are treated as now. |
| `limit` | 200 | 1 to 200. |

Out-of-range values are clamped to the nearest bound and unparseable values take the default. Neither is refused, so check what you sent if a result surprises you. A `since` without an offset is read in the server's local time zone; always include one.

There is no paging. On a map that holds a busy system you may not be able to reach kills older than the newest 200 within the last 7 days.

| Field | Type | Meaning |
|---|---|---|
| `killmailId` | string | |
| `killmailTime` | string | |
| `mapSystemId` | string | The `systems[].id` of the system. |
| `systemId` | number | EVE solar-system id. |
| `systemName` | string | |
| `shipTypeId` | number or null | The victim's ship type. |
| `shipTypeName` | string or null | |
| `victimCharacterId` | string or null | |
| `victimCorporationId` | string or null | |
| `victimAllianceId` | string or null | |
| `attackerCount` | number | |
| `totalValue` | number or null | zKillboard's ISK estimate, when one was recorded. |

Ids only: the API does not resolve victim or attacker names.

**Coverage is best-effort.** This endpoint reads only Aperture's local killmail cache; serving a request never calls zKillboard or ESI. The cache fills from two sources:

- Aperture's live zKillboard feed, when the operator runs it. The feed is live only, with no backfill: it records a kill if the kill's system was on an active map when the kill arrived. A system added to a map has no feed history from before it was added, and a deployment that does not run the feed records nothing this way.
- The in-app killboard, which caches the kills it shows whenever a member opens it for a system.

So an empty list means "no kills Aperture knows about", not "no kills happened". Older cached rows can have `totalValue: null`.

## Errors

| HTTP | `code` | Meaning | What to do |
|---|---|---|---|
| 401 | `invalid_token` | The token is missing, malformed, unknown, revoked or expired, or its map was deleted. These are deliberately indistinguishable. | Stop. Get a new token. |
| 403 | `account_blocked` | The owning account is blocked from the API. | Stop. The owner sees the reason and the end of the block in Aperture. |
| 403 | `token_suspended` | The token is suspended for ignoring rate limits. Carries `Retry-After`. | Wait for `Retry-After`. Requests sent while suspended count toward the next strike. |
| 403 | `api_disabled` | The map's API is turned off. | Stop until a manager turns it back on. |
| 403 | `access_lost` | The owning account has no main character, or its main can no longer view the map or sign in. | Stop. |
| 403 | `scope_not_granted` | The endpoint's scope is not in the token's effective scopes. | Check `GET /api/v1/token`. |
| 429 | `rate_limited` | A rate limit was hit. Carries `Retry-After`. | Wait for `Retry-After`. |
| 500 | `server_error` | The server failed to build the response, usually a brief database outage. | Retry with backoff. |
| 404 | none | The operator has turned the whole API off (body has no `code`), or the path does not exist. | |

401 responses carry `WWW-Authenticate: Bearer`.

`GET`, `HEAD` and `OPTIONS` are served. `HEAD` is handled exactly as `GET`: it passes the same checks, carries the same headers and counts against the same rate limits. Any other method gets the framework's default 405, without the API's headers.

## Rate limits

Limits use fixed one-minute windows aligned to the clock: every counter resets at the start of each wall-clock minute, for every client at once.

| Limit | Requests per minute |
|---|---|
| Per token | 60 |
| Per account, summed over all its tokens | 150 |
| Per IP address | 600 |
| Whole API | 6 000 |

Creating more tokens does not raise your budget: every token on one account shares the account limit.

What a request is charged to depends on how far it got:

- A 429 from the per-IP limit or from a failed-authentication block (below) is charged to nothing.
- A 401, a 403 other than `scope_not_granted`, and a 429 from the token, account or whole-API limit are charged to the per-IP limit only.
- Everything else is charged to the per-IP, token, account and whole-API limits. That includes a 304 and a `scope_not_granted` 403: a client that keeps calling an endpoint whose scope was taken away spends its budget on the refusals and runs into 429s.

Polling faster than every 5 seconds buys nothing: data is cached for 5 seconds, so a faster poller receives the same data. Polling all seven endpoints every 10 seconds is 42 requests a minute, inside the per-token limit.

**Headers.** Responses that reached the rate-limit step carry:

| Header | Meaning |
|---|---|
| `RateLimit-Limit` | The limit of the budget you are closest to exhausting: the per-token, per-account or whole-API limit. On a 429, the limit that refused the request. |
| `RateLimit-Remaining` | Requests left this window in that same budget. |
| `RateLimit-Reset` | Seconds until the window resets. |

Both headers always describe the same budget, so `RateLimit-Limit` minus `RateLimit-Remaining` is what that budget has spent, which may include your other tokens' requests. These headers are present on successes, 304s, the rate-limit 429, `scope_not_granted` and `server_error`. They are **absent** on 401s, on `account_blocked`, `token_suspended`, `api_disabled` and `access_lost`, and on the per-IP 429, because those are answered before the token's budget is consulted.

Every 429 and every `token_suspended` carries `Retry-After` in seconds. Honour it.

**Failed authentication.** More than 20 failed authentications from one IP address within a window block that address for 1 minute. A failed authentication is a 401 for a missing, malformed or unknown token, or for a token revoked for abuse. A token revoked by a person, an expired token or a token on a deleted map still answers 401 but does not count, so one forgotten script cannot block the other tools on its machine. Repeated failing windows escalate the block to 5 minutes and then 30 minutes. While blocked, every request from the address answers 429 `rate_limited` with `Retry-After`, whatever token it carries.

## Caching, ETag and 304

Every data response carries a weak `ETag`. Send it back in `If-None-Match`; if the data has not changed the response is `304 Not Modified` with no body. The ETag describes the data, not `generatedAt`, so it stays the same across refreshes of unchanged data. `mass-log?connection=` and `kills` compute an ETag for the filtered result, so it changes with the query parameters.

A 304 still counts against the rate limit.

Responses are `Cache-Control: private, no-store`: do not put them in a shared cache.

## Abuse handling

Abuse has one definition: **continuing to send requests after being told to stop.** A client that honours `Retry-After` cannot trigger any of this.

- A **hot window** is a one-minute window in which one token had at least 60 requests refused for its token limit or its account limit, or sent while suspended. Refusals from the whole-API ceiling do not count.
- Three hot windows within 10 minutes are a **strike**.

| Strike | Consequence |
|---|---|
| 1 | The token is suspended for 15 minutes. |
| 2 | The token is suspended for 6 hours. |
| 3 | The token is revoked, and the owning account is blocked from the API. |

A token's strike count starts over when its previous strike is more than 7 days old.

An **account block** covers every character on the account. While it stands the account cannot create tokens and every token it owns answers `account_blocked`. A first block lasts 7 days. A second block that begins within 180 days of the previous one lasts until an instance admin lifts it. Admins can also block an account by hand, until they lift it, with a stated reason. The account sees the reason and the end of the block in Aperture.

Token creation, suspensions and revocations appear in the map's audit log, which only its managers and delegated titles can read, naming the token's label and its owner. They are not posted to the map's Discord history webhook. The token itself is never logged.

## Blackout

Blackout is an instance-wide mode in which members stop seeing other pilots. A token sees exactly what its owner sees:

- If the owning account is not on Blackout's cleared list, `pilots` returns only that account's own characters, and `mass-log` answers `hidden: true` with an empty list.
- If the owning account is cleared, both endpoints return the full picture.

Turning Blackout on or off, or changing the cleared list, applies to tokens on the next request or within 10 seconds respectively. The other endpoints are not affected by Blackout.

## CORS

The API sends `Access-Control-Allow-Origin: *` and answers `OPTIONS` preflights allowing `GET` with the `Authorization` and `If-None-Match` headers. `ETag`, `Retry-After`, the `RateLimit-*` headers and `WWW-Authenticate` are exposed to scripts.

This is safe because the API never reads a cookie: authority comes only from the bearer token you send. A browser-based tool can call the API directly, but any token embedded in a web page is visible to everyone who can load that page.

## Notes for operators

- The switch for the whole API is in **Admin, Settings, User API**. Turning it off answers 404 to every `GET`, `HEAD` and `OPTIONS` request on `/api/v1/*` and refuses new tokens. Each map's managers still decide whether their own map exposes it.
- Block and lift account blocks from **Admin, Members**. Every character of a blocked account shows an "API blocked" badge. Account blocks are not map events; they are logged at `warn`.
- The per-IP limits need each caller's real address. Set `TRUSTED_PROXY_HOPS` to the number of reverse proxies in front of Aperture (default `1`, `0` for none): the address is read that many entries from the right of `X-Forwarded-For`, so entries a client wrote itself are ignored. A wrong value lets a client choose its own address, or makes every caller share your proxy's. As a second safeguard, have the outermost proxy replace `X-Forwarded-For` with the address it sees instead of appending to the client's value. See the README's [Behind a reverse proxy](../../README.md#behind-a-reverse-proxy) section.
- Aperture never stores a client's IP address. IP counters live in memory and are discarded when their window ends.
- Metrics: `user_api_requests_total{endpoint,outcome}`, `user_api_strikes_total{level}`, `user_api_tokens_live` and `user_api_tokens_suspended`.
