/**
 * Process-wide count of live WebSocket connections — the source for the
 * `ws_connections` metrics gauge.
 *
 * Written by the WS server (`wsServer.ts`, loaded by the custom `server.ts`
 * outside Next's bundler) on connect/close; read by `gauges.ts` (inside Next's
 * bundler for `/metrics`, and from the worker for the snapshot job). Those live
 * in separate module graphs, so the counter is pinned on `globalThis` via a
 * registered symbol — one holder per Node process, reachable from both —
 * mirroring `mapViewers.ts`/`bus.ts`.
 *
 * Purely in-memory and ephemeral: a process restart resets it to zero and
 * clients re-announce when they reconnect.
 *
 * No `import 'server-only'`: like `mapViewers.ts`/`wsServer.ts` this is imported
 * on the `server.ts` side where the `server-only` shim doesn't resolve.
 */

type Holder = { count: number };

const HOLDER_KEY = Symbol.for('aperture.realtime.wsConnections');

function holder(): Holder {
  const slot = globalThis as Record<symbol, unknown>;
  let h = slot[HOLDER_KEY] as Holder | undefined;
  if (!h) {
    h = { count: 0 };
    slot[HOLDER_KEY] = h;
  }
  return h;
}

/** Record one more live WebSocket connection. */
export function incWsConnection(): void {
  holder().count += 1;
}

/** Record that one live WebSocket connection has closed. Floors at zero. */
export function decWsConnection(): void {
  const h = holder();
  if (h.count > 0) h.count -= 1;
}

/** Current number of live WebSocket connections in this process. */
export function wsConnectionCount(): number {
  return holder().count;
}
