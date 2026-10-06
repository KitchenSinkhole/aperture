'use client';

/**
 * Watched wormholes — the per-map set of connections this device wants a cue
 * for when a tracked pilot jumps one. Personal and device-local: one
 * localStorage key per map, never sent to the server. Connections hard-delete
 * when a hole collapses, so a watch is dropped by the connection's delete,
 * never by its absence from a view. A map view hides the connections of an
 * invisible system while their rows (and the holes) survive.
 *
 * Each entry carries the epoch-ms instant the watch was set, and one older than
 * `WATCHED_CONNECTION_TTL_MS` is dropped when the map's set is next read. That
 * is what reclaims a watch whose delete this device never observed — the tab
 * was closed, the socket dropped and `resync()` re-seeded from a snapshot, or
 * an expiry job reaped the hole while nobody was logged in.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { apertureConfig } from '../../aperture.config';

export const watchedConnectionsKey = (mapId: string) => `aperture:map:${mapId}:watched-connections`;

/** Epoch-ms instant each watch was set, keyed by connection id. */
type WatchStamps = ReadonlyMap<string, number>;

type Snapshot = { stamps: WatchStamps; ids: ReadonlySet<string> };

const EMPTY: Snapshot = { stamps: new Map(), ids: new Set() };

// Per-map snapshot cache so a canvas full of edges doesn't re-parse the blob on
// every render. Invalidated by our own writes and by another tab's. Expiry is
// applied when a snapshot is built, so a watch never vanishes mid-session under
// the cursor of a user who is looking at its badge.
const cache = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
let detachStorage: (() => void) | null = null;

function snapshotOf(stamps: WatchStamps): Snapshot {
  return { stamps, ids: new Set(stamps.keys()) };
}

function serialize(stamps: WatchStamps): string {
  return JSON.stringify(Object.fromEntries(stamps));
}

function write(mapId: string, stamps: WatchStamps): void {
  try {
    const key = watchedConnectionsKey(mapId);
    if (stamps.size === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, serialize(stamps));
  } catch {}
}

function compute(mapId: string): Snapshot {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(watchedConnectionsKey(mapId));
    if (!raw) return EMPTY;
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return EMPTY;

  const cutoff = Date.now() - apertureConfig.WATCHED_CONNECTION_TTL_MS;
  const stamps = new Map<string, number>();
  let dropped = false;
  for (const [id, watchedAt] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof watchedAt !== 'number' || !Number.isFinite(watchedAt) || watchedAt <= cutoff) {
      dropped = true;
      continue;
    }
    stamps.set(id, watchedAt);
  }
  // Compact in place so the key shrinks rather than being filtered forever on
  // read. Silent: the expired entries are absent from the snapshot being built,
  // so no subscriber's view of the world changes.
  if (dropped) write(mapId, stamps);
  return snapshotOf(stamps);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  // A `null` key is a whole-storage clear, which drops every map's set.
  if (event.key === null) {
    cache.clear();
    notify();
    return;
  }
  for (const mapId of cache.keys()) {
    if (watchedConnectionsKey(mapId) !== event.key) continue;
    cache.delete(mapId);
    notify();
    return;
  }
}

function persist(mapId: string, stamps: WatchStamps): void {
  write(mapId, stamps);
  cache.set(mapId, snapshotOf(stamps));
  notify();
}

function read(mapId: string): Snapshot {
  let snapshot = cache.get(mapId);
  if (!snapshot) {
    snapshot = compute(mapId);
    cache.set(mapId, snapshot);
  }
  return snapshot;
}

/** Every connection watched on this map. Reference-stable between writes. */
export function readWatchedConnections(mapId: string): ReadonlySet<string> {
  return read(mapId).ids;
}

/** Whether one connection is watched on this device. */
export function isConnectionWatched(mapId: string, connectionId: string): boolean {
  return read(mapId).ids.has(connectionId);
}

/**
 * Flip one connection's watch and persist it. Watching stamps the entry with
 * the current time, which starts its TTL afresh. Returns the resulting state.
 */
export function toggleConnectionWatch(mapId: string, connectionId: string): boolean {
  const next = new Map(read(mapId).stamps);
  const watched = !next.has(connectionId);
  if (watched) next.set(connectionId, Date.now());
  else next.delete(connectionId);
  persist(mapId, next);
  return watched;
}

/**
 * Drop one connection's watch because the hole is gone. Writes and notifies
 * only when the connection was actually watched.
 */
export function dropWatchedConnection(mapId: string, connectionId: string): void {
  const current = read(mapId).stamps;
  if (!current.has(connectionId)) return;
  const next = new Map(current);
  next.delete(connectionId);
  persist(mapId, next);
}

/**
 * Subscribe to watch changes; returns an unsubscribe fn. While at least one
 * listener is registered the store tracks the `storage` event, so a watch
 * toggled in another tab reaches this one without a reload.
 */
export function subscribeWatchedConnections(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    detachStorage = () => window.removeEventListener('storage', onStorage);
    // Another tab may have written while nothing here was listening.
    cache.clear();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    detachStorage?.();
    detachStorage = null;
  };
}

/** Live watch state for one connection, re-rendering the caller on a toggle. */
export function useIsConnectionWatched(mapId: string, connectionId: string): boolean {
  const getSnapshot = useCallback(
    () => isConnectionWatched(mapId, connectionId),
    [mapId, connectionId],
  );
  return useSyncExternalStore(subscribeWatchedConnections, getSnapshot, () => false);
}
