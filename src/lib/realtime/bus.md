## bus.ts

**Purpose:** Server-side Postgres LISTEN multiplexer — the read end of the §6.5 realtime pipeline; reference-counts `map:<id>` channel subscriptions on one dedicated `pg` Client and wraps each notification into a `mapUpdate` envelope.
**File:** `src/lib/realtime/bus.ts`

---

### bus.subscribe(mapId: bigint, listener: (message: ServerToClientMessage) => void): () => void
Registers a listener for one map's events. First subscriber on a map issues `LISTEN "map:<id>"`; the returned unsubscribe drops the listener and `UNLISTEN`s when the last one leaves. Lazily connects the dedicated client on first use.

**Returns:** an unsubscribe function.

---

### bus.isHealthy(): boolean
Whether the dedicated LISTEN connection is currently live. Used by the WS health probe.

---

### bus.subscriberCount(): number
Total active map subscriptions across all channels. Lets the health probe (`src/lib/health/probe.ts`) distinguish an **idle** bus (zero subscribers ⇒ the lazy connection is intentionally not open) from a connection that dropped while subscribers expect it.

---

### Notes
- Uses its **own `pg.Client`** (not the pooled `db`) because LISTEN occupies a connection for its lifetime.
- On notification, parses the payload as JSON (non-JSON → `{}`), derives `mapId` from the channel name, and emits one of two envelopes:
  - **`{ task: 'mapUpdate', load: { mapId, kind?, data } }`** — default path. `data` is a **trusted passthrough** of the trigger payload — a `MapEventPayload` built and validated by `commitMapEvent`; the bus re-wraps it without re-parsing (clients revalidate on receipt). `kind` is lifted from the payload when present.
  - **`{ task: 'characterUpdate', load }`** — when the pg_notify payload has a top-level `task: 'characterUpdate'` (location-poll broadcast). The bus validates the `load` against `characterUpdateLoadSchema` and drops malformed envelopes silently.
  - **`{ task: 'characterLogout', load }`** — when the pg_notify payload has a top-level `task: 'characterLogout'` (access-revocation broadcast, `src/lib/realtime/characterLogout.ts`). The bus validates the `load` against `characterLogoutLoadSchema` and drops malformed envelopes silently. Clients drop the named pilots from the presence roster.
  - **`{ task: 'systemNotification', load }`** — when the pg_notify payload has a top-level `task: 'systemNotification'`. Two producers: the zKB feed (`kind: 'killmail'`) and the user-initiated ping (`kind: 'ping'`, `src/lib/map/ping.ts`). The bus validates the `load` against `systemNotificationLoadSchema` (a `kind`-discriminated union) and drops malformed envelopes silently.
  - **`{ task: 'connectionMassLog', load }`** — when the pg_notify payload has a top-level `task: 'connectionMassLog'` (mass-log broadcast). The bus validates the `load` against `connectionMassLogLoadSchema` and drops malformed envelopes silently.
- **Metrics (Phase 8):** every received notification increments `pg_notify_received_total{channel='map'}` (the `map:<id>` channel collapsed to a bounded class). After building an envelope, the listener-delivery loop is timed and `recordRealtimeBroadcast(message.task, durationMs)` tallies `realtime_broadcasts_total{task}` + observes `realtime_fanout_duration_ms` (the in-process dispatch→deliver span). Malformed envelopes that drop before delivery are counted as received but not broadcast.
- Reconnects with exponential backoff (`WS_RECONNECT_BASE_MS`/`WS_RECONNECT_MAX_MS`) and re-issues LISTEN for all live channels on reconnect.
- Singleton across HMR via a `globalThis` guard (mirrors `db/client.ts`).
- No `import 'server-only'`: this module is loaded by the custom `server.ts` outside Next's bundler (where the `server-only` shim doesn't resolve). It is only imported by `wsServer.ts` and tests — never by a client component.

### Depends On
- `pg` (`Client`), `./protocol` (`ServerToClientMessage`, `MapEventPayload`), `aperture.config` (channel prefix, backoff), `@/lib/env`.
