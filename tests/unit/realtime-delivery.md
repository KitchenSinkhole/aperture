## realtime-delivery.test.tsx

**Purpose:** Proves the `RealtimeProvider` / `useRealtimeEvents` listener registry delivers every inbound envelope exactly once — closing the same-tick burst-coalescing gap that the old single-slot `lastEvent` state had.
**File:** `tests/unit/realtime-delivery.test.tsx`

### Setup
- Stubs `globalThis.SharedWorker` with a `FakeSharedWorker` whose `port` (a `FakePort`) is captured in a module-level `lastPort`. The provider sets `port.onmessage` and calls `port.start()`; the test drives delivery by invoking `port.onmessage({ data: { type: 'message', envelope: { task, load } } })` directly.
- Renders with `react-dom/client` `createRoot` + React's `act` (sets `IS_REACT_ACT_ENVIRONMENT`) so mount effects (provider boots the worker, probe registers its listener) flush. No `@testing-library/react` dependency.
- A `Probe` component calls `useRealtimeEvents` and pushes each envelope's `load.n` into a `received[]` array.

### Cases
- **delivers every envelope in a same-tick burst, in order** — fires N=5 frames synchronously inside one `act()` (no await between, so React cannot flush between deliveries) and asserts `received === [0,1,2,3,4]`. The old `useState(lastEvent)` implementation would coalesce these to a single value; the listener registry delivers all N.
- **stops delivering after the consumer unmounts** — fires one frame with the Probe mounted, re-renders without the Probe, fires a second frame, and asserts only the first was received (the `useRealtimeEvents` effect cleanup tore the listener down).

### `sharedWorker per-port routing` (describe block)
Exercises `src/lib/realtime/sharedWorker.ts` directly rather than through the client-side provider mock above: stubs `globalThis.self` with a `FakeSelf` that captures the `connect` listener the module registers at import time, and `globalThis.WebSocket` with a `FakeWebSocket` whose constructed instances are collected in a static `instances` array, read as `instances[0]`. `vi.resetModules()` + a fresh dynamic `import('@/lib/realtime/sharedWorker')` per test gives each test its own worker-module state (`ports`/`subscriptions`/`socket`). `FakeSelf.dispatchConnect(port)` simulates a tab attaching; the resulting `FakePort` (reused from above) is driven both ways — `port.onmessage({...})` simulates the tab sending `subscribe`/`unsubscribe`, and `port.postMessage.mock.calls` capture what the worker sent back.
- **routes a mapId-tagged envelope only to the matching subscriber** — two ports subscribe to different maps; an inbound envelope tagged `mapId: 1` reaches only the port subscribed to map 1.
- **fans a control-plane frame (no mapId) out to every port** — an inbound envelope with no `mapId` (e.g. `healthCheck`) reaches both ports regardless of their map subscriptions.

### Depends On
- `@/lib/realtime/useRealtime` (`RealtimeProvider`, `useRealtimeEvents`), `@/lib/realtime/protocol` (`Envelope` type), `@/lib/realtime/sharedWorker` (dynamically imported by the routing block).
