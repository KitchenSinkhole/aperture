## wsServer.ts

**Purpose:** Node-runtime WebSocket server attached to the shared Next.js HTTP server; broadcast-only fan-out of `mapUpdate` envelopes from the LISTEN bus, with session-authorized `subscribe`/`unsubscribe`.
**File:** `src/lib/realtime/wsServer.ts`

---

### attachWsServer(httpServer: http.Server): WebSocketServer
Wires a `noServer` `ws` server onto the HTTP server's `upgrade` event. Only upgrades requests to `apertureConfig.WS_PATH`; all other upgrade requests are left for Next/HMR. Returns the `WebSocketServer`.

Per connection:
- **Auth at upgrade:** decodes the Auth.js v5 session cookie (`__Secure-authjs.session-token` / `authjs.session-token`) via `next-auth/jwt` `decode` keyed on `AUTH_SECRET`. No/invalid session → `401` and the socket is destroyed.
- **subscribe:** validated by `clientToServerMessageSchema`; each map id is filtered through `canViewMap(characterId, mapId)` (existence + soft-delete + scope/owner/role rights all in one). Requests for maps the actor cannot see are silently dropped (no acknowledgement; existence is not leaked over realtime). Allowed ids are wired to `bus.subscribe` and the **account** (`session.userId`) is counted into the `mapViewers` roster (`addMapViewer`) so `GET /api/map/[mapId]/viewers` can tell which accounts (and thus which of their characters) have the map open. **Per-map tracking seed (per-map-character-tracking plan):** each allowed map id is passed to `seedTrackingForMap({ mapId, userId })`, which on the account's *first* open of that map auto-tracks all its active characters and on every subsequent open is a no-op (the `ap_map_tracking_seed` marker gates it). The user's explicit per-map selection — made in the Characters panel, including an empty one — is never overwritten. Tracking is server-side and survives tab close.
- **unsubscribe:** tears down the matching bus subscriptions and decrements the `mapViewers` roster (`removeMapViewer`); does not stop location tracking.
- Malformed frames are dropped silently.
- **Heartbeat:** every `WS_HEARTBEAT_MS` the server `ping`s each socket (terminating any that missed the prior pong) and sends an app-level `healthCheck` envelope so a quiet map still clears the client's degraded banner.
- On close, all of the socket's bus subscriptions are released and its `mapViewers` counts are decremented.
- **Connection gauge:** `incWsConnection()` on connect / `decWsConnection()` on close keep the process-wide live-socket count (`wsConnections.ts`) current for the `ws_connections` metrics gauge.

---

### isWsServerAttached(): boolean
Whether `attachWsServer` has run in this process.

### Notes
- The socket is **broadcast-only** — clients never mutate over it (CLAUDE.md "Realtime").
- No `import 'server-only'`: loaded by the custom `server.ts` outside Next's bundler (the `server-only` shim doesn't resolve there); only `server.ts` and tests import it.

### Depends On
- `ws`, `next-auth/jwt` (`decode`), `@/lib/auth/rights` (`canViewMap`), `@/lib/jobs/tracking` (`seedTrackingForMap`), `@/lib/log/logger` (`getLogger('server')` — per-frame `debug` trace), `./bus`, `./mapViewers` (`addMapViewer`/`removeMapViewer`), `./wsConnections` (`incWsConnection`/`decWsConnection`), `./protocol`, `aperture.config`, `@/lib/env`.
