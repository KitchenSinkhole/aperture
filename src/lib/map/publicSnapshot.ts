import 'server-only';
import { apertureConfig } from '../../../aperture.config';
import { loadPublicMapView, type PublicMapViewData } from './loadPublicMap';

/**
 * Serving layer for the public share snapshot: a short-TTL, LRU-bounded cache
 * over `loadPublicMapView` plus the rate limiter guarding the snapshot route.
 *
 * The projection is viewer-independent, so a single load can be handed to
 * every viewer of a token. That is not an optimisation — it is what makes an
 * arbitrarily large anonymous audience survivable on one Postgres box, so
 * concurrent misses are coalesced onto one in-flight load rather than each
 * opening its own query.
 *
 * State is a `globalThis` singleton (mirror of `bus.ts` / `clientErrorRate.ts`)
 * so it survives HMR.
 */

type CacheEntry = { value: PublicMapViewData | null; expiresAt: number };

type RateWindow = { count: number; start: number };

interface SnapshotState {
  cache: Map<string, CacheEntry>;
  inflight: Map<string, Promise<PublicMapViewData | null>>;
  global: RateWindow;
  perIp: Map<string, RateWindow>;
}

declare global {
  var __aperturePublicSnapshot: SnapshotState | undefined;
}

function freshState(): SnapshotState {
  return {
    cache: new Map(),
    inflight: new Map(),
    global: { count: 0, start: 0 },
    perIp: new Map(),
  };
}

const state: SnapshotState = globalThis.__aperturePublicSnapshot ?? freshState();
globalThis.__aperturePublicSnapshot = state;

/**
 * The redacted snapshot for `token`, served from cache when a live entry
 * exists. `null` (unknown, expired, revoked, soft-deleted parent) is cached
 * too, so token guessing cannot be turned into a stream of database reads.
 *
 * `now` and `load` are injectable for tests.
 */
export async function getPublicSnapshot(
  token: string,
  now: number = Date.now(),
  load: (t: string) => Promise<PublicMapViewData | null> = loadPublicMapView,
): Promise<PublicMapViewData | null> {
  const hit = state.cache.get(token);
  if (hit && hit.expiresAt > now) {
    // Re-insert to move the entry to the tail — Map iterates in insertion
    // order, so the head is the least recently used.
    state.cache.delete(token);
    state.cache.set(token, hit);
    return hit.value;
  }

  const inflight = state.inflight.get(token);
  if (inflight) return inflight;

  const pending = load(token)
    .then((value) => {
      state.cache.delete(token);
      state.cache.set(token, {
        value,
        expiresAt: now + apertureConfig.PUBLIC_SNAPSHOT_CACHE_TTL_MS,
      });
      evictOverflow();
      return value;
    })
    .finally(() => {
      state.inflight.delete(token);
    });

  state.inflight.set(token, pending);
  return pending;
}

/** Drops `token`'s cached snapshot so the next read reloads it. */
export function invalidatePublicSnapshot(token: string): void {
  state.cache.delete(token);
}

function evictOverflow(): void {
  while (state.cache.size > apertureConfig.PUBLIC_SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldest = state.cache.keys().next();
    if (oldest.done) return;
    state.cache.delete(oldest.value);
  }
}

/**
 * Whether a snapshot request from `clientKey` (a best-effort client IP) is
 * accepted right now. Fixed-window counters: when the global window elapses it
 * rolls and the per-IP map is cleared, bounding memory regardless of how many
 * distinct addresses called. Returns `false` — answer 429 — once either the
 * per-IP cap (`PUBLIC_SNAPSHOT_MAX_PER_IP`) or the global cap
 * (`PUBLIC_SNAPSHOT_MAX_GLOBAL`) is exceeded for the window.
 *
 * `now` is injectable for tests.
 */
export function allowPublicSnapshotRequest(clientKey: string, now: number = Date.now()): boolean {
  const windowMs = apertureConfig.PUBLIC_SNAPSHOT_RATE_WINDOW_MS;

  if (now - state.global.start >= windowMs) {
    state.global = { count: 0, start: now };
    state.perIp.clear();
  }

  let ip = state.perIp.get(clientKey);
  if (!ip || now - ip.start >= windowMs) {
    ip = { count: 0, start: now };
    state.perIp.set(clientKey, ip);
  }

  if (
    state.global.count >= apertureConfig.PUBLIC_SNAPSHOT_MAX_GLOBAL ||
    ip.count >= apertureConfig.PUBLIC_SNAPSHOT_MAX_PER_IP
  ) {
    return false;
  }

  state.global.count += 1;
  ip.count += 1;
  return true;
}

/** Test seam: clear cache and rate-limit state between cases. */
export function __resetPublicSnapshotState(): void {
  state.cache.clear();
  state.inflight.clear();
  state.global = { count: 0, start: 0 };
  state.perIp.clear();
}
