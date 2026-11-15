## bus.ts

**Purpose:** Server-side Postgres LISTEN multiplexer — the read end of the §6.5 realtime pipeline; reference-counts `map:<id>` channel subscriptions on one dedicated `pg` Client and wraps each notification into a `mapUpdate` envelope; also relays instance-channel notifies to `onInstanceNotify` listeners.
**File:** `src/lib/realtime/bus.ts`

---

### bus.subscribe(mapId: bigint, listener: (message: ServerToClientMessage) => void): () => void
Registers a listener for one map's events. First subscriber on a map issues `LISTEN "map:<id>"`; the returned unsubscribe drops the listener and `UNLISTEN`s when the last one leaves. Connects the dedicated client if it isn't already.

**Returns:** an unsubscribe function.

---

### bus.onInstanceNotify(listener: () => void): () => void
Registers a listener for instance-wide state changes (the Blackout switch and its cleared list) on `apertureConfig.INSTANCE_NOTIFY_CHANNEL`. The notify carries no payload and produces no envelope; a listener re-reads what it needs. Also fires after every (re)connect, because a notify sent while the LISTEN connection was down is lost. Connects the dedicated client if it isn't already.

**Returns:** an unsubscribe function.

---

### bus.isHealthy(): boolean
Whether the dedicated LISTEN connection is currently live. Used by the WS health probe.

---

### bus.subscriberCount(): number
Total active map subscriptions across all channels (instance listeners not counted).

---

### bus.instanceListenerCount(): number
Registered `onInstanceNotify` listeners. The connection opens on the first map subscription or instance listener and is held while either exists; the WS server registers an instance listener at attach, so in the running app the connection is open from startup whether or not any map is. The health probe (`src/lib/health/probe.ts`) reads this with `subscriberCount` to tell an idle bus from a dropped connection.

---

### Notes
- Uses its **own `pg.Client`** (not the pooled `db`) because LISTEN occupies a connection for its lifetime.
- On notification, parses the payload as JSON (non-JSON → `{}`), derives `mapId` from the channel name, and emits one of five envelopes. Every emitted message carries that same `mapId` at the envelope's top level (not just nested in `load`), so a fan-out consumer can route on source map without inspecting `load`:
  - **`{ task: 'mapUpdate', load: { mapId, kind?, data }, mapId }`** — default path. `data` is a **trusted passthrough** of the trigger payload — a `MapEventPayload` built and validated by `commitMapEvent`; the bus re-wraps it without re-parsing (clients revalidate on receipt). `kind` is lifted from the payload when present.
  - **`{ task: 'characterUpdate', load, mapId }`** — when the pg_notify payload has a top-level `task: 'characterUpdate'` (location-poll broadcast). The bus validates the `load` against `characterUpdateLoadSchema` and drops malformed envelopes silently.
  - **`{ task: 'characterLogout', load, mapId }`** — when the pg_notify payload has a top-level `task: 'characterLogout'` (access-revocation broadcast, `src/lib/realtime/characterLogout.ts`). The bus validates the `load` against `characterLogoutLoadSchema` and drops malformed envelopes silently. Clients drop the named pilots from the presence roster.
  - **`{ task: 'systemNotification', load, mapId }`** — when the pg_notify payload has a top-level `task: 'systemNotification'`. Two producers: the zKB feed (`kind: 'killmail'`) and the user-initiated ping (`kind: 'ping'`, `src/lib/map/ping.ts`). The bus validates the `load` against `systemNotificationLoadSchema` (a `kind`-discriminated union) and drops malformed envelopes silently.
  - **`{ task: 'connectionMassLog', load, mapId }`** — when the pg_notify payload has a top-level `task: 'connectionMassLog'` (mass-log broadcast). The bus validates the `load` against `connectionMassLogLoadSchema` and drops malformed envelopes silently.
- Every connect LISTENs on the instance channel alongside the live map channels, for the bus's lifetime. An instance notify only calls the `onInstanceNotify` listeners.
- **Metrics (Phase 8):** every received notification increments `pg_notify_received_total{channel}`: `'map'` (the `map:<id>` channel collapsed to a bounded class) or `'instance'`. After building an envelope, the listener-delivery loop is timed and `recordRealtimeBroadcast(message.task, durationMs)` tallies `realtime_broadcasts_total{task}` + observes `realtime_fanout_duration_ms` (the in-process dispatch→deliver span). Malformed envelopes that drop before delivery are counted as received but not broadcast.
- Reconnects with exponential backoff (`WS_RECONNECT_BASE_MS`/`WS_RECONNECT_MAX_MS`) while any map or instance listener remains, and re-issues LISTEN for all live channels on reconnect.
- Pinned on `globalThis` in every environment: one instance per process, shared by the `server.ts` module graph (WS server) and Next's bundled graph (health probe), and surviving HMR.
- No `import 'server-only'`: this module is loaded by the custom `server.ts` outside Next's bundler (where the `server-only` shim doesn't resolve). It is only imported by `wsServer.ts` and tests — never by a client component.

### Depends On
- `pg` (`Client`), `./protocol` (`ServerToClientMessage`, `MapEventPayload`), `aperture.config` (channel prefix, instance channel, backoff), `@/lib/env`.
