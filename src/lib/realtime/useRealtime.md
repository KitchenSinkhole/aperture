## useRealtime.tsx

**Purpose:** Client-side realtime façade — boots the SharedWorker, exposes the connection status through context, fans every inbound envelope out to registered listeners, and provides map subscribe/unsubscribe.
**File:** `src/lib/realtime/useRealtime.tsx`

### Exports

#### `RealtimeProvider` (component)
Mounts the SharedWorker once, relays its status into React state, and provides the context. Because React runs child effects before parent effects, a map page's `useMapSubscription` calls `subscribe()` before this provider's effect has created the port; requested map ids are recorded in a `desiredRef` set and flushed to the worker once the port is ready. Falls back to permanent `degraded` status when `SharedWorker` is unavailable (e.g. Safari). Runs a staleness watchdog: if no traffic (including the server heartbeat) arrives within `WS_HEALTH_STALE_MS` while the socket claims `open`, it forces `degraded` — never silently stale.

**Envelope delivery is NOT React state.** Each parsed envelope is dispatched synchronously inside `port.onmessage` to every listener in a `listenersRef` set (`for (const l of listenersRef.current) l(env)`). This is deliberate: a single `useState` slot would coalesce a same-tick burst (React batches state updates) down to the last envelope, silently dropping the intermediate ones — e.g. a wormhole jump's `system.added` + `connection.create` + `characterUpdate` arriving in one frame would drop the connection. The registry delivers all N in arrival order. The context value therefore changes only when `status` or the Blackout standing changes, so consumers don't re-render per envelope.

Each `healthCheck` that carries `blackout` updates the provider's Blackout standing (the per-socket `BlackoutStatus`); one without it keeps the current value, and an unchanged standing keeps the same reference.

| Prop | Type | Required | Description |
|---|---|---|---|
| children | ReactNode | yes | App subtree that can read realtime context. |

#### `useRealtime(): { status, blackout, subscribe, unsubscribe, subscribeToEvents }`
Context accessor; throws outside a `RealtimeProvider`. `status: RealtimeStatus`; `blackout: BlackoutStatus | null` is the latest `healthCheck.blackout`, null until the first one; `subscribeToEvents(listener): () => void` registers an envelope listener (stable identity, returns an unsubscribe fn). Prefer the `useRealtimeEvents` hook over calling `subscribeToEvents` directly. No `lastEvent` — events flow through the listener registry, not context.

#### `useRealtimeEvents(listener: (env: Envelope) => void): void`
Runs `listener` for every inbound envelope, exactly once each, in arrival order — including same-tick bursts a `useState` slot would coalesce. The listener may change every render without re-subscribing (held in a ref, updated in an effect); the underlying subscription is stable for the component's lifetime. The canonical way every consumer (`MapCanvas`, `MapPresenceContext`, `MapUnderglowBridge`, `ConnectionMassLog`) reads realtime events: each filters on `envelope.task` and folds the validated load into its own state/store.

#### `useReconnectResync(onReconnect: () => void): void`
Fires `onReconnect` when the socket returns to `open` **after** a disconnect (`degraded`/`closed`), recovering events the SharedWorker dropped during the gap (it resumes only NEW events on reconnect). Does **not** fire on the initial mount-open — the page-load snapshot is already fresh — because the provider starts at `connecting` and only `degraded`/`closed` arm the resync; `connecting` is ignored. `onReconnect` is held in a ref so a changing callback identity doesn't re-run the transition effect (which depends on `status` only). `MapCanvas` passes its existing `resync()` (snapshot refetch + dedupe-set reset).

#### `useBlackoutStatus(initial: BlackoutStatus): BlackoutStatus`
The viewer's live standing under Blackout: the provider's latest `healthCheck.blackout`, or `initial` (the map payload's `blackout`) until the first one arrives, so a tab joining an already-running SharedWorker has its standing from first paint. Throws outside a `RealtimeProvider`.

#### `useMapSubscription(mapId: number | null): void`
Subscribes to one map for the calling component's lifetime; unsubscribes on unmount.

### Types
- `RealtimeStatus` — `'connecting' | 'open' | 'closed' | 'degraded'` (re-exported from `src/types/index.ts`).

### Depends On
- `./protocol` (`envelopeSchema`, `healthCheckLoadSchema`, `Envelope`, `BlackoutStatus`), `./sharedWorker` (via `new SharedWorker(new URL(...))`), `aperture.config`.

### Tested by
- `tests/unit/realtime-delivery.test.tsx` — proves a same-tick burst of N frames reaches a `useRealtimeEvents` consumer all N times in order, and that delivery stops after the consumer unmounts.
- `tests/unit/blackout-presence.test.tsx` — `useBlackoutStatus` seeding from `initial`, live updates from `healthCheck`, and a `healthCheck` without `blackout` keeping the current value.
- `tests/unit/realtime-reconnect.test.tsx` — proves `useReconnectResync` fires on `open` only after a `degraded`/`closed` gap, not on the initial mount-open, and re-arms for each subsequent disconnect.
