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

**Public connections** (`WS_PUBLIC_PATH`, share token as the `?token=` query param):
- **Admission at upgrade, in order:** `allowPublicUpgrade` (per-IP + global rate limit) → `429`; `resolveShareToken(token)` → `401` on any failure (missing token, garbage, unknown, expired, revoked — all identical, no disclosure); `publicSocketCount(token) >= PUBLIC_WS_MAX_PER_TOKEN` → `503`. A rejected upgrade is how the client learns to degrade to polling. Each of the four outcomes tallies `public_ws_upgrades_total{outcome}` (`recordPublicWsUpgrade`), which is what distinguishes an audience that connected from one that was bounced to polling.
- The resolved `{ mapId, profile }` pins the socket for its lifetime — invariant 3 of the public-share design: a public socket's channel is never chosen by anything the client sends.
- Subscribes once to `bus.subscribe(mapId, …)` and translates messages through an allowlist into at most a `publicUpdate` nudge: `mapUpdate` always nudges; `characterUpdate`/`characterLogout` nudge only when the token's `presenceMode !== 'none'`; `mapDeleted` closes the socket (code `4001`); everything else (`healthCheck`, `systemNotification`, `connectionMassLog`, `mapAccess`, `mapConnectionAccess`, `logData`) is dropped. The bus message itself is never forwarded — `publicUpdate`'s load (`{ ts }`) cannot carry map data by construction, which is what keeps `loadPublicMapView` the only code path emitting public map data.
- **Nudge coalescing:** at most one `publicUpdate` per `PUBLIC_WS_NUDGE_MIN_INTERVAL_MS`, trailing — a burst of edits collapses to one frame per interval instead of one per edit.
- Registered in the `publicSockets.ts` registry (`registerPublicSocket`) keyed by token, so `revokeShareToken` (`src/lib/map/share.ts`) can close every live socket for a revoked token (also code `4001`).
- Receives no client frame: `subscribe`/`unsubscribe` don't apply, and any inbound data is dropped. Opens no presence session and touches neither `mapViewers` nor tracking — those are account concepts a public socket has none of.

**Heartbeat (shared):** every `WS_HEARTBEAT_MS` the server `ping`s every socket, session and public alike, terminating any that missed the prior pong. Session sockets additionally get an app-level `healthCheck` envelope (clears the degraded banner on a quiet map) and are batched into one `touchPresenceSessions` call; public sockets get neither — they have no degraded banner and no app-level vocabulary beyond `publicUpdate`.

---

### isWsServerAttached(): boolean
Whether `attachWsServer` has run in this process.

### Notes
- The socket is **broadcast-only** — clients never mutate over it (CLAUDE.md "Realtime").
- No `import 'server-only'`: loaded by the custom `server.ts` outside Next's bundler (the `server-only` shim doesn't resolve there); only `server.ts` and tests import it.

### Depends On
- `ws`, `next-auth/jwt` (`decode`), `@/lib/auth/rights` (`canViewMap`), `@/lib/http/clientKey` (`clientKeyFromForwardedFor`), `@/lib/jobs/tracking` (`seedTrackingForMap`), `@/lib/log/logger` (`getLogger('server')` — per-frame `debug` trace), `@/lib/map/share` (`resolveShareToken`), `@/lib/metrics/registry` (`recordPublicWsUpgrade`), `./bus`, `./mapViewers` (`addMapViewer`/`removeMapViewer`), `./presenceSessions` (`openPresenceSession`/`touchPresenceSessions`), `./publicSockets` (`allowPublicUpgrade`/`registerPublicSocket`/`publicSocketCount`), `./wsConnections` (`incWsConnection`/`decWsConnection`), `./protocol`, `aperture.config`, `@/lib/env`, `@/types` (`ShareRedactionProfile`).
