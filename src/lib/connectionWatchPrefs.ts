'use client';

/**
 * Watched wormholes — the per-map set of connections this device wants a cue
 * for when a tracked pilot jumps one. Personal and device-local: one
 * localStorage key per map, never sent to the server. Connections hard-delete
 * when a hole collapses, so a watch is dropped by the connection's delete,
 * never by its absence from a view. A map view hides the connections of an
 * invisible system while their rows (and the holes) survive. Identity ids are
 * never reused, so an entry left behind by a delete this device never saw can
 * match no future connection.
 */

import { useCallback, useSyncExternalStore } from 'react';

export const watchedConnectionsKey = (mapId: string) => `aperture:map:${mapId}:watched-connections`;

const EMPTY: ReadonlySet<string> = new Set<string>();

// Per-map snapshot cache so a canvas full of edges doesn't re-parse the blob on
// every render. Invalidated by our own writes and by another tab's.
const cache = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
let detachStorage: (() => void) | null = null;

function compute(mapId: string): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(watchedConnectionsKey(mapId));
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return EMPTY;
  }
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

function persist(mapId: string, set: ReadonlySet<string>): void {
  try {
    const key = watchedConnectionsKey(mapId);
    if (set.size === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify([...set]));
  } catch {}
  cache.set(mapId, set);
  notify();
}

/** Every connection watched on this map. Reference-stable between writes. */
export function readWatchedConnections(mapId: string): ReadonlySet<string> {
  let set = cache.get(mapId);
  if (!set) {
    set = compute(mapId);
    cache.set(mapId, set);
  }
  return set;
}

/** Whether one connection is watched on this device. */
export function isConnectionWatched(mapId: string, connectionId: string): boolean {
  return readWatchedConnections(mapId).has(connectionId);
}

/** Flip one connection's watch and persist it. Returns the resulting state. */
export function toggleConnectionWatch(mapId: string, connectionId: string): boolean {
  const next = new Set(readWatchedConnections(mapId));
  const watched = !next.has(connectionId);
  if (watched) next.add(connectionId);
  else next.delete(connectionId);
  persist(mapId, next);
  return watched;
}

/**
 * Drop one connection's watch because the hole is gone. Writes and notifies
 * only when the connection was actually watched.
 */
export function dropWatchedConnection(mapId: string, connectionId: string): void {
  const current = readWatchedConnections(mapId);
  if (!current.has(connectionId)) return;
  const next = new Set(current);
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
