## wsConnections.ts

**Purpose:** Process-wide count of live WebSocket connections — the source for the `ws_connections` metrics gauge.
**File:** `src/lib/realtime/wsConnections.ts`

---

Pinned on `globalThis` via a registered symbol (mirrors `mapViewers.ts`) so the `server.ts`-side writer and the Next-bundler/worker-side reader share one holder. In-memory and ephemeral — a restart resets it to zero. No `server-only` import.

### incWsConnection(): void
Record one more live WebSocket connection. Called by `wsServer.ts` on `connection`.

### decWsConnection(): void
Record that one connection has closed (floors at zero). Called by `wsServer.ts` on `close`.

### wsConnectionCount(): number
Current number of live WebSocket connections in this process. Read by `gauges.ts`.
