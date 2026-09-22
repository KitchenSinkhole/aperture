import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('connectionWatchPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
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
    expect(JSON.parse(stored(mapId)!)).toEqual(['c1']);
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
    localStorage.setItem(watchedConnectionsKey(mapId), JSON.stringify(['c1', 'c2']));
    expect([...readWatchedConnections(mapId)]).toEqual(['c1', 'c2']);
  });

  it.each([
    ['a non-array', '{"c1":true}'],
    ['unparsable text', 'not json'],
  ])('falls back to nothing watched on %s blob', (_label, raw) => {
    const mapId = nextMapId();
    localStorage.setItem(watchedConnectionsKey(mapId), raw);
    expect(readWatchedConnections(mapId).size).toBe(0);
  });

  it('drops the deleted hole and leaves every other watch alone', () => {
    const mapId = nextMapId();
    toggleConnectionWatch(mapId, 'c1');
    toggleConnectionWatch(mapId, 'c2');
    dropWatchedConnection(mapId, 'c1');
    expect(isConnectionWatched(mapId, 'c1')).toBe(false);
    expect(isConnectionWatched(mapId, 'c2')).toBe(true);
    expect(JSON.parse(stored(mapId)!)).toEqual(['c2']);
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
