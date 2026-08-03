// No `import 'server-only'`: like `wsConnections.ts`/`mapViewers.ts` this is
// imported by `wsServer.ts` on the `server.ts` side, outside Next's bundler,
// where the `server-only` shim doesn't resolve.

import { apertureConfig } from '../../../aperture.config';

/**
 * Admission and registry for token-authed public WebSocket sockets (Stage 5
 * of the public map share). Two responsibilities:
 *
 * - `allowPublicUpgrade` — a fixed-window per-IP + global rate limiter on the
 *   upgrade handshake itself, mirroring `publicSnapshot.ts`'s
 *   `allowPublicSnapshotRequest` (global window roll clears the per-IP map,
 *   bounding memory regardless of how many distinct addresses called).
 * - The socket registry — which live sockets belong to which share token, so
 *   `wsServer.ts` can enforce `PUBLIC_WS_MAX_PER_TOKEN` at upgrade and
 *   `revokeShareToken` (`src/lib/map/share.ts`) can close every socket for a
 *   revoked token.
 *
 * `globalThis`-pinned singleton so it survives HMR and is reachable from both
 * module graphs, mirroring `wsConnections.ts` / `mapViewers.ts` / `bus.ts`.
 */

type CloseFn = (code: number) => void;

type RateWindow = { count: number; start: number };

interface PublicSocketState {
  byToken: Map<string, Set<CloseFn>>;
  upgradeGlobal: RateWindow;
  upgradePerIp: Map<string, RateWindow>;
}

declare global {
  var __aperturePublicSockets: PublicSocketState | undefined;
}

function freshState(): PublicSocketState {
  return {
    byToken: new Map(),
    upgradeGlobal: { count: 0, start: 0 },
    upgradePerIp: new Map(),
  };
}

const state: PublicSocketState = globalThis.__aperturePublicSockets ?? freshState();
globalThis.__aperturePublicSockets = state;

/**
 * Whether a public WS upgrade from `clientKey` is accepted right now. Same
 * fixed-window shape as `allowPublicSnapshotRequest`: when the global window
 * elapses it rolls and the per-IP map is cleared, bounding memory regardless
 * of how many distinct addresses attempted an upgrade.
 *
 * `now` is injectable for tests.
 */
export function allowPublicUpgrade(clientKey: string, now: number = Date.now()): boolean {
  const windowMs = apertureConfig.PUBLIC_WS_UPGRADE_WINDOW_MS;

  if (now - state.upgradeGlobal.start >= windowMs) {
    state.upgradeGlobal = { count: 0, start: now };
    state.upgradePerIp.clear();
  }

  let ip = state.upgradePerIp.get(clientKey);
  if (!ip || now - ip.start >= windowMs) {
    ip = { count: 0, start: now };
    state.upgradePerIp.set(clientKey, ip);
  }

  if (
    state.upgradeGlobal.count >= apertureConfig.PUBLIC_WS_MAX_UPGRADES_GLOBAL ||
    ip.count >= apertureConfig.PUBLIC_WS_MAX_UPGRADES_PER_IP
  ) {
    return false;
  }

  state.upgradeGlobal.count += 1;
  ip.count += 1;
  return true;
}

/**
 * Registers a live public socket for `token` and returns its deregister
 * function. `close` lets `closePublicSocketsForToken` end the socket without
 * this module knowing anything about `ws`.
 */
export function registerPublicSocket(token: string, close: CloseFn): () => void {
  let sockets = state.byToken.get(token);
  if (!sockets) {
    sockets = new Set();
    state.byToken.set(token, sockets);
  }
  sockets.add(close);

  return () => {
    const current = state.byToken.get(token);
    if (!current) return;
    current.delete(close);
    if (current.size === 0) state.byToken.delete(token);
  };
}

/** Live public socket count for one share token. */
export function publicSocketCount(token: string): number {
  return state.byToken.get(token)?.size ?? 0;
}

/** Live public socket count across every share token. */
export function publicSocketTotal(): number {
  let total = 0;
  for (const sockets of state.byToken.values()) total += sockets.size;
  return total;
}

/**
 * Closes every live public socket pinned to `token` (e.g. on revoke). Returns
 * how many were closed. Snapshots the registered closers before iterating,
 * since each `close` call runs the deregister function that mutates the same
 * set the caller is iterating over.
 */
export function closePublicSocketsForToken(token: string): number {
  const sockets = state.byToken.get(token);
  if (!sockets) return 0;
  const closers = [...sockets];
  for (const close of closers) close(4001);
  return closers.length;
}

/** Test seam: clear the registry and rate-limit state between cases. */
export function __resetPublicSockets(): void {
  state.byToken.clear();
  state.upgradeGlobal = { count: 0, start: 0 };
  state.upgradePerIp.clear();
}
