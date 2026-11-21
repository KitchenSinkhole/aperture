import 'server-only';
import { createHash } from 'node:crypto';
import { isBlackedOut } from '@/lib/auth/blackout';
import type {
  BlackoutViewer,
  UserApiPayload,
  UserApiProjectionEntry,
  UserApiResource,
} from '@/types';
import { apertureConfig } from '../../../aperture.config';
import { loadUserApiProjection } from './projection';

/**
 * Serving cache for the user API's read projections: short-TTL, LRU-bounded,
 * with concurrent misses for one key coalesced onto a single in-flight load,
 * so any number of tokens polling one map cost one query set per TTL.
 *
 * Viewer-independent resources are keyed by map and resource. `pilots` and
 * `mass_log` add the Blackout visibility: `full`, or `own:<userId>` while
 * Blackout restricts the token's owner.
 *
 * State is a `globalThis` singleton so it survives HMR.
 */

type CacheEntry = { entry: UserApiProjectionEntry; expiresAt: number };

export type UserApiProjectionLoader = (
  mapId: bigint,
  resource: UserApiResource,
  viewer: BlackoutViewer,
) => Promise<UserApiPayload>;

interface ProjectionCacheState {
  cache: Map<string, CacheEntry>;
  inflight: Map<string, Promise<UserApiProjectionEntry>>;
  /** Bumped by `clearUserApiProjections`; a load begun under an older value is not cached. */
  generation: number;
}

declare global {
  var __apertureUserApiProjection: ProjectionCacheState | undefined;
}

const state: ProjectionCacheState = globalThis.__apertureUserApiProjection ?? {
  cache: new Map(),
  inflight: new Map(),
  generation: 0,
};
globalThis.__apertureUserApiProjection = state;

/** The cache key of one resource of one map as `viewer` may see it. */
export function userApiProjectionKey(
  mapId: bigint,
  resource: UserApiResource,
  viewer: BlackoutViewer,
): string {
  const base = `${mapId.toString()}:${resource}`;
  if (resource !== 'pilots' && resource !== 'mass_log') return base;
  return `${base}:${isBlackedOut(viewer) ? `own:${viewer.userId}` : 'full'}`;
}

/**
 * One resource of one map, served from cache while a live entry exists, else
 * loaded and cached for `USER_API_PROJECTION_TTL_MS`. A rejected load caches
 * nothing and propagates.
 *
 * `now` and `load` are injectable for tests.
 */
export async function getUserApiProjection<R extends UserApiResource>(
  mapId: bigint,
  resource: R,
  viewer: BlackoutViewer,
  now: number = Date.now(),
  load: UserApiProjectionLoader = loadUserApiProjection,
): Promise<UserApiProjectionEntry<R>> {
  const key = userApiProjectionKey(mapId, resource, viewer);
  const hit = state.cache.get(key);
  if (hit && hit.expiresAt > now) {
    // Re-insert to move the entry to the tail: Map iterates in insertion
    // order, so the head is the least recently used.
    state.cache.delete(key);
    state.cache.set(key, hit);
    return hit.entry as UserApiProjectionEntry<R>;
  }

  const inflight = state.inflight.get(key);
  if (inflight) return inflight as Promise<UserApiProjectionEntry<R>>;

  const generation = state.generation;
  const pending = load(mapId, resource, viewer)
    .then((payload) => {
      const entry = toEntry(payload, now);
      if (generation !== state.generation) return entry;
      state.cache.delete(key);
      state.cache.set(key, { entry, expiresAt: now + apertureConfig.USER_API_PROJECTION_TTL_MS });
      evictOverflow();
      return entry;
    })
    .finally(() => {
      if (state.inflight.get(key) === pending) state.inflight.delete(key);
    });

  state.inflight.set(key, pending);
  return pending as Promise<UserApiProjectionEntry<R>>;
}

function toEntry(payload: UserApiPayload, now: number): UserApiProjectionEntry {
  const generatedAt = new Date(now).toISOString();
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
  return {
    payload,
    generatedAt,
    body: JSON.stringify({ ok: true, ...payload, generatedAt }),
    etag: `W/"${digest.slice(0, 27)}"`,
  };
}

function evictOverflow(): void {
  while (state.cache.size > apertureConfig.USER_API_PROJECTION_CACHE_MAX_ENTRIES) {
    const oldest = state.cache.keys().next();
    if (oldest.done) return;
    state.cache.delete(oldest.value);
  }
}

/**
 * Drops every cached projection, and stops any load already in flight from
 * caching its result, so nothing read before this call is served after it.
 */
export function clearUserApiProjections(): void {
  state.generation += 1;
  state.cache.clear();
  state.inflight.clear();
}

/** Test seam: the number of cached projections. */
export function __userApiProjectionCacheSize(): number {
  return state.cache.size;
}
