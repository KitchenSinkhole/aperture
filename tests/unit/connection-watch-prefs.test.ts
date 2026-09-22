import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apertureConfig } from '../../aperture.config';
import {
  dropWatchedConnection,
  isConnectionWatched,
  readWatchedConnections,
  subscribeWatchedConnections,
  toggleConnectionWatch,
  watchedConnectionsKey,
} from '@/lib/connectionWatchPrefs';

// The store caches one snapshot per map id for the module's lifetime, so every
// test works on a map of its own rather than fighting a stale cache entry.
let mapCounter = 0;
const nextMapId = () => `map-${++mapCounter}`;

function stored(mapId: string): string | null {
  return localStorage.getItem(watchedConnectionsKey(mapId));
}

/** The watched ids in the stored blob, ignoring their timestamps. */
function storedIds(mapId: string): string[] {
  return Object.keys(JSON.parse(stored(mapId)!) as Record<string, number>);
}

/** Seed a map's key directly with each watch stamped `agoMs` in the past. */
function seed(mapId: string, entries: Record<string, number>): void {
  const now = Date.now();
  const blob = Object.fromEntries(
    Object.entries(entries).map(([id, agoMs]) => [id, now - agoMs]),
  );
  localStorage.setItem(watchedConnectionsKey(mapId), JSON.stringify(blob));
}

/**
 * Force the next read to rebuild from localStorage. Attaching the first
 * listener drops the cache, which is what a fresh page load does.
 */
function dropSnapshotCache(): void {
  subscribeWatchedConnections(() => {})();
}

const TTL = apertureConfig.WATCHED_CONNECTION_TTL_MS;

describe('connectionWatchPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with nothing watched', () => {
    const mapId = nextMapId();
    expect(readWatchedConnections(mapId).size).toBe(0);
    expect(isConnectionWatched(mapId, 'c1')).toBe(false);
  });

  it('persists a watch and reports the resulting state', () => {
    const mapId = nextMapId();
    expect(toggleConnectionWatch(mapId, 'c1')).toBe(true);
    expect(isConnectionWatched(mapId, 'c1')).toBe(true);
    expect(storedIds(mapId)).toEqual(['c1']);
  });

  it('unwatches on a second toggle and drops the key once empty', () => {
    const mapId = nextMapId();
    toggleConnectionWatch(mapId, 'c1');
    expect(toggleConnectionWatch(mapId, 'c1')).toBe(false);
    expect(isConnectionWatched(mapId, 'c1')).toBe(false);
    expect(stored(mapId)).toBeNull();
  });

  it('keeps each map independent', () => {
    const a = nextMapId();
    const b = nextMapId();
    toggleConnectionWatch(a, 'c1');
    expect(isConnectionWatched(a, 'c1')).toBe(true);
    expect(isConnectionWatched(b, 'c1')).toBe(false);
  });

  it('reads a set written by an earlier session', () => {
    const mapId = nextMapId();
    seed(mapId, { c1: 0, c2: 60_000 });
    expect([...readWatchedConnections(mapId)]).toEqual(['c1', 'c2']);
  });

  it.each([
    ['an array', '["c1"]'],
    ['non-numeric stamps', '{"c1":true}'],
    ['unparsable text', 'not json'],
  ])('falls back to nothing watched on %s', (_label, raw) => {
    const mapId = nextMapId();
    localStorage.setItem(watchedConnectionsKey(mapId), raw);
    expect(readWatchedConnections(mapId).size).toBe(0);
  });

  it('keeps a watch that has not reached its TTL', () => {
    const mapId = nextMapId();
    seed(mapId, { c1: TTL - 60_000 });
    expect(isConnectionWatched(mapId, 'c1')).toBe(true);
  });

  it('expires a watch older than the TTL and compacts the stored key', () => {
    const mapId = nextMapId();
    seed(mapId, { c1: TTL + 60_000, c2: 60_000 });
    expect([...readWatchedConnections(mapId)]).toEqual(['c2']);
    expect(storedIds(mapId)).toEqual(['c2']);
  });

  it('removes the key when every watch has expired', () => {
    const mapId = nextMapId();
    seed(mapId, { c1: TTL + 60_000 });
    expect(readWatchedConnections(mapId).size).toBe(0);
    expect(stored(mapId)).toBeNull();
  });

  it('expires a watch that outlives its TTL within one session', () => {
    vi.useFakeTimers();
    const mapId = nextMapId();
    toggleConnectionWatch(mapId, 'c1');
    vi.advanceTimersByTime(TTL + 60_000);
    // The cached snapshot holds until something invalidates it, so the watch
    // survives in place rather than vanishing under the user mid-session.
    expect(isConnectionWatched(mapId, 'c1')).toBe(true);
    dropSnapshotCache();
    expect(isConnectionWatched(mapId, 'c1')).toBe(false);
    expect(stored(mapId)).toBeNull();
  });

  it('restarts the TTL when a watch is set again', () => {
    vi.useFakeTimers();
    const mapId = nextMapId();
    seed(mapId, { c1: TTL - 60_000 });
    expect(toggleConnectionWatch(mapId, 'c1')).toBe(false);
    expect(toggleConnectionWatch(mapId, 'c1')).toBe(true);
    vi.advanceTimersByTime(TTL - 60_000);
    dropSnapshotCache();
    expect(isConnectionWatched(mapId, 'c1')).toBe(true);
  });

  it('drops the deleted hole and leaves every other watch alone', () => {
    const mapId = nextMapId();
    toggleConnectionWatch(mapId, 'c1');
    toggleConnectionWatch(mapId, 'c2');
    dropWatchedConnection(mapId, 'c1');
    expect(isConnectionWatched(mapId, 'c1')).toBe(false);
    expect(isConnectionWatched(mapId, 'c2')).toBe(true);
    expect(storedIds(mapId)).toEqual(['c2']);
  });

  it('drops the key when the last watched hole goes', () => {
    const mapId = nextMapId();
    toggleConnectionWatch(mapId, 'c1');
    dropWatchedConnection(mapId, 'c1');
    expect(stored(mapId)).toBeNull();
  });

  it('does not notify when the dropped connection was not watched', () => {
    const mapId = nextMapId();
    toggleConnectionWatch(mapId, 'c1');
    const listener = vi.fn();
    const unsubscribe = subscribeWatchedConnections(listener);
    dropWatchedConnection(mapId, 'c2');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies subscribers on a toggle and on a drop that removes something', () => {
    const mapId = nextMapId();
    const listener = vi.fn();
    const unsubscribe = subscribeWatchedConnections(listener);
    toggleConnectionWatch(mapId, 'c1');
    expect(listener).toHaveBeenCalledTimes(1);
    dropWatchedConnection(mapId, 'c1');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    toggleConnectionWatch(mapId, 'c2');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
