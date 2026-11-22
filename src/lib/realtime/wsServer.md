## wsServer.ts

**Purpose:** Node-runtime WebSocket server attached to the shared Next.js HTTP server; broadcast-only fan-out of `mapUpdate` envelopes from the LISTEN bus, with session-authorized `subscribe`/`unsubscribe`, plus a second token-authed upgrade path for anonymous public spectator sockets.
**File:** `src/lib/realtime/wsServer.ts`

---

### attachWsServer(httpServer: http.Server): WebSocketServer
Wires two `noServer` `ws` servers onto the HTTP server's `upgrade` event, routed by `pathname`: the session path at `apertureConfig.WS_PATH`, and a public path at `apertureConfig.WS_PUBLIC_PATH`. Any other upgrade request is left for Next/HMR. Returns the session `WebSocketServer`.

**Session connections** (`WS_PATH`):
- **Auth at upgrade:** decodes the Auth.js v5 session cookie (`__Secure-authjs.session-token` / `authjs.session-token`) via `next-auth/jwt` `decode` keyed on `AUTH_SECRET`. No/invalid session → `401` and the socket is destroyed.
- **subscribe:** validated by `clientToServerMessageSchema`; each map id is filtered through `canViewMap(characterId, mapId)` (existence + soft-delete + scope/owner/role rights all in one). Requests for maps the actor cannot see are silently dropped (no acknowledgement; existence is not leaked over realtime). Allowed ids are wired to `bus.subscribe` and the **account** (`session.userId`) is counted into the `mapViewers` roster (`addMapViewer`) so `GET /api/map/[mapId]/viewers` can tell which accounts (and thus which of their characters) have the map open. **Per-map tracking seed (per-map-character-tracking plan):** each allowed map id is passed to `seedTrackingForMap({ mapId, userId })`, which on the account's *first* open of that map auto-tracks all its active characters and on every subsequent open is a no-op (the `ap_map_tracking_seed` marker gates it). The user's explicit per-map selection — made in the Characters panel, including an empty one — is never overwritten. Tracking is server-side and survives tab close.
- **unsubscribe:** tears down the matching bus subscriptions and decrements the `mapViewers` roster (`removeMapViewer`); does not stop location tracking.
- Malformed frames are dropped silently.
- **Presence (docs/plans/integration-presence.md):** on connect, fire-and-forget `openPresenceSession(characterId)` populates `ClientState.presenceSessionId` — never blocks or rejects the socket on a write failure. On close, a final `touchPresenceSessions([presenceSessionId])` stamps `ended_at`. Presence is keyed per **character** (`session.characterId`), unlike `mapViewers`, which is per account.
- On close, all of the socket's bus subscriptions are released and its `mapViewers` counts are decremented.
- **Connection gauge:** `incWsConnection()` on connect / `decWsConnection()` on close keep the process-wide live-socket count (`wsConnections.ts`) current for the `ws_connections` metrics gauge.
- **Blackout:** the server holds the switch in memory (`getBlackoutState`), read at attach, on every `bus.onInstanceNotify`, and on every heartbeat. Each socket holds its account's standing: `isBlackoutCleared(userId)` plus every character id on the account (any status). Standing is resolved on connect, on every instance notify, and on every heartbeat while Blackout is on (grant expiry and title changes send no notify) or while the socket's standing is unsettled, with one lookup per account per pass. Reads of the switch and of each socket's standing are ordered by a `ReadSequence`: the newest successful read is applied, whatever finishes in between. Every bus message on the session forward goes through `filterSessionMessage` with that standing.
- **Fail closed:** the switch counts as on while it is unsettled (never read, or an instance notify arrived and no read begun after it has succeeded), and a socket counts as not cleared while its standing is unsettled (never resolved, an instance notify arrived and no lookup begun after it has succeeded, or its latest lookup failed). An instance notify unsettles the switch and every socket's standing synchronously, so presence and mass-log frames the bus dispatches right behind it are filtered as restricted until both re-reads land. A failed re-read stays unsettled until a heartbeat re-read succeeds.
- **Instance notify:** after re-reading the switch and re-resolving every socket (concurrently), sends each session socket an immediate `healthCheck` with its own state.
- **Switch flip:** whenever an applied read of the switch changes `active` (an unread switch counts as on), every public socket whose share publishes presence gets a `publicUpdate` through its coalesced nudge (`publicNudgeOnBlackoutFlip`), so an open spectator page refetches with presence hidden or restored.

**Public connections** (`WS_PUBLIC_PATH`, share token as the `?token=` query param):
- **Admission at upgrade, in order:** `allowPublicUpgrade` (per-IP + global rate limit) → `429`; `resolveShareToken(token)` → `401` on any failure (missing token, garbage, unknown, expired, revoked — all identical, no disclosure); `publicSocketCount(token) >= PUBLIC_WS_MAX_PER_TOKEN` → `503`. A rejected upgrade is how the client learns to degrade to polling. Each of the four outcomes tallies `public_ws_upgrades_total{outcome}` (`recordPublicWsUpgrade`), which is what distinguishes an audience that connected from one that was bounced to polling.
- The resolved `{ mapId, profile }` pins the socket for its lifetime — invariant 3 of the public-share design: a public socket's channel is never chosen by anything the client sends.
- Subscribes once to `bus.subscribe(mapId, …)` and translates messages through `publicActionFor` into at most a `publicUpdate` nudge: `mapUpdate` always nudges; `characterUpdate`/`characterLogout` nudge only when the token's `presenceMode !== 'none'` and Blackout is off (an unsettled switch counts as on); `mapDeleted` closes the socket (code `4001`); everything else (`healthCheck`, `systemNotification`, `connectionMassLog`, `mapAccess`, `mapConnectionAccess`, `logData`) is dropped. The bus message itself is never forwarded — `publicUpdate`'s load (`{ ts }`) cannot carry map data by construction, which is what keeps `loadPublicMapView` the only code path emitting public map data.
- A Blackout switch flip also nudges the socket when its `presenceMode !== 'none'` (see "Switch flip" above).
- **Nudge coalescing:** at most one `publicUpdate` per `PUBLIC_WS_NUDGE_MIN_INTERVAL_MS`, trailing — a burst of edits collapses to one frame per interval instead of one per edit.
- Registered in the `publicSockets.ts` registry (`registerPublicSocket`) keyed by token, so `revokeShareToken` (`src/lib/map/share.ts`) can close every live socket for a revoked token (also code `4001`).
- Receives no client frame: `subscribe`/`unsubscribe` don't apply, and any inbound data is dropped. Opens no presence session and touches neither `mapViewers` nor tracking — those are account concepts a public socket has none of.

**Heartbeat (shared):** every `WS_HEARTBEAT_MS` the server `ping`s every socket, session and public alike, terminating any that missed the prior pong. Session sockets additionally get an app-level `healthCheck` envelope (clears the degraded banner on a quiet map) and are batched into one `touchPresenceSessions` call; public sockets get neither — they have no degraded banner and no app-level vocabulary beyond `publicUpdate`. Each beat also re-reads the switch, then re-resolves standing (see "Blackout" above), and a socket whose reported `blackout` changed over that pass gets a further `healthCheck` at once.

**healthCheck contents:** every `healthCheck` carries `build` (`getBuildId()`) and, while both the switch and that socket's standing are settled, that socket's `blackout: { active, since, cleared }`, built per socket. While either is unsettled `blackout` is omitted, and the client keeps its current value. One is sent on session connect as soon as the switch and the socket's standing are known, so a client that reconnected through a deploy learns the new build and its Blackout state without waiting a heartbeat interval.

---

### filterSessionMessage(message: ServerToClientMessage, viewer: BlackoutViewer, ownCharacterIds: ReadonlySet\<number\>): ServerToClientMessage | null
Pure. What a session socket receives of one bus message. When `isBlackedOut(viewer)` is false the message passes unchanged. Otherwise: `characterUpdate` passes only when `isPilotHidden(viewer, load.userId)` is false (the viewer's own account); `characterLogout` is narrowed to the ids in `ownCharacterIds`, passed as-is when all are own, and dropped when none are; `connectionMassLog` is dropped; every other task passes unchanged.

**Returns:** the message, a narrowed copy, or `null` to drop it.

---

### publicActionFor(message: ServerToClientMessage, profile: ShareRedactionProfile, blackoutActive: boolean): 'nudge' | 'close' | null
Pure. How a public socket answers one bus message, per the translation table above. The bus message itself is never forwarded: `nudge` sends a data-free `publicUpdate`.

---

### publicNudgeOnBlackoutFlip(profile: ShareRedactionProfile, wasActive: boolean, isActive: boolean): boolean
Pure. Whether a public socket gets a `publicUpdate` when the server re-reads the Blackout switch: true only when `active` changed and the share's `presenceMode !== 'none'`.

---

### isWsServerAttached(): boolean
Whether `attachWsServer` has run in this process.

### Notes
- The socket is **broadcast-only** — clients never mutate over it (CLAUDE.md "Realtime").
- No `import 'server-only'`: loaded by the custom `server.ts` outside Next's bundler (the `server-only` shim doesn't resolve there); only `server.ts` and tests import it.

### Depends On
- `ws`, `next-auth/jwt` (`decode`), `@/db/client` + `ap_character` (an account's character ids), `@/lib/auth/blackout` (`getBlackoutState`, `isBlackoutCleared`, `isBlackedOut`, `isPilotHidden`), `@/lib/auth/rights` (`canViewMap`), `@/lib/buildId` (`getBuildId`), `@/lib/http/clientKey` (`clientIpOfNodeRequest`), `@/lib/jobs/tracking` (`seedTrackingForMap`), `@/lib/log/logger` (`getLogger('server')` — per-frame `debug` trace), `@/lib/map/share` (`resolveShareToken`), `@/lib/metrics/registry` (`recordPublicWsUpgrade`), `./bus`, `./mapViewers` (`addMapViewer`/`removeMapViewer`), `./presenceSessions` (`openPresenceSession`/`touchPresenceSessions`), `./publicSockets` (`allowPublicUpgrade`/`registerPublicSocket`/`publicSocketCount`), `./readSequence` (`ReadSequence`), `./wsConnections` (`incWsConnection`/`decWsConnection`), `./protocol`, `aperture.config`, `@/lib/env`, `@/types` (`BlackoutState`, `BlackoutViewer`, `ShareRedactionProfile`).
