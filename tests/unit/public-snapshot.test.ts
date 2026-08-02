// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apertureConfig } from '../../aperture.config';
import {
  allowPublicSnapshotRequest,
  getPublicSnapshot,
  invalidatePublicSnapshot,
  __resetPublicSnapshotState,
} from '@/lib/map/publicSnapshot';
import type { PublicMapViewData } from '@/lib/map/loadPublicMap';

// DB-free: both the cache and the limiter are pure in-memory state, and the
// loader is injected, so the whole serving layer is unit-testable. `now` is
// injected throughout so TTL and the fixed rate window are deterministic.

const TTL = apertureConfig.PUBLIC_SNAPSHOT_CACHE_TTL_MS;
const MAX_ENTRIES = apertureConfig.PUBLIC_SNAPSHOT_CACHE_MAX_ENTRIES;
const PER_IP = apertureConfig.PUBLIC_SNAPSHOT_MAX_PER_IP;
const GLOBAL = apertureConfig.PUBLIC_SNAPSHOT_MAX_GLOBAL;
const WINDOW = apertureConfig.PUBLIC_SNAPSHOT_RATE_WINDOW_MS;

// Start well past the window so the first call cleanly rolls the fresh state.
const T = 1_000_000;

function snapshot(name: string): PublicMapViewData {
  return {
    map: { name, shareLabel: 'label' },
    systems: [],
    connections: [],
    signatures: null,
    presence: { mode: 'none' },
    entrances: [],
  };
}

beforeEach(() => {
  __resetPublicSnapshotState();
});

describe('getPublicSnapshot', () => {
  it('serves one load to every viewer within the TTL', async () => {
    const load = vi.fn(async (t: string) => snapshot(t));

    const first = await getPublicSnapshot('tok', T, load);
    const second = await getPublicSnapshot('tok', T + TTL - 1, load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('reloads once the entry expires', async () => {
    const load = vi.fn(async (t: string) => snapshot(t));

    await getPublicSnapshot('tok', T, load);
    await getPublicSnapshot('tok', T + TTL, load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent misses onto one in-flight load', async () => {
    let release!: (v: PublicMapViewData) => void;
    const load = vi.fn(
      () => new Promise<PublicMapViewData>((resolve) => { release = resolve; }),
    );

    const a = getPublicSnapshot('tok', T, load);
    const b = getPublicSnapshot('tok', T, load);
    release(snapshot('tok'));

    expect(await a).toBe(await b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('caches a miss so token guessing does not reach the loader twice', async () => {
    const load = vi.fn(async () => null);

    expect(await getPublicSnapshot('bogus', T, load)).toBeNull();
    expect(await getPublicSnapshot('bogus', T + 1, load)).toBeNull();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after an explicit invalidation', async () => {
    const load = vi.fn(async (t: string) => snapshot(t));

    await getPublicSnapshot('tok', T, load);
    invalidatePublicSnapshot('tok');
    await getPublicSnapshot('tok', T, load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches nothing when the load rejects', async () => {
    const load = vi
      .fn<(t: string) => Promise<PublicMapViewData | null>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(snapshot('tok'));

    await expect(getPublicSnapshot('tok', T, load)).rejects.toThrow('boom');
    await expect(getPublicSnapshot('tok', T, load)).resolves.toEqual(snapshot('tok'));
  });

  it('evicts the least recently used token past the cache cap', async () => {
    const load = vi.fn(async (t: string) => snapshot(t));

    for (let i = 0; i < MAX_ENTRIES; i++) await getPublicSnapshot(`t${i}`, T, load);
    // Touch the oldest so it is no longer the eviction candidate, then overflow.
    await getPublicSnapshot('t0', T, load);
    await getPublicSnapshot('overflow', T, load);

    load.mockClear();
    await getPublicSnapshot('t0', T, load);
    expect(load).not.toHaveBeenCalled();

    await getPublicSnapshot('t1', T, load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('allowPublicSnapshotRequest', () => {
  it('accepts up to the per-IP cap, then drops', () => {
    for (let i = 0; i < PER_IP; i++) expect(allowPublicSnapshotRequest('1.1.1.1', T)).toBe(true);
    expect(allowPublicSnapshotRequest('1.1.1.1', T)).toBe(false);
  });

  it("does not let one address's flood exhaust another (below the global cap)", () => {
    for (let i = 0; i < PER_IP + 5; i++) allowPublicSnapshotRequest('1.1.1.1', T);
    expect(allowPublicSnapshotRequest('2.2.2.2', T)).toBe(true);
  });

  it('drops across addresses once the global cap is reached', () => {
    const addresses = Math.floor(GLOBAL / PER_IP);
    for (let a = 0; a < addresses; a++) {
      for (let i = 0; i < PER_IP; i++) expect(allowPublicSnapshotRequest(`a${a}`, T)).toBe(true);
    }
    expect(allowPublicSnapshotRequest('fresh', T)).toBe(false);
  });

  it('re-allows after the window rolls', () => {
    for (let i = 0; i < PER_IP; i++) allowPublicSnapshotRequest('1.1.1.1', T);
    expect(allowPublicSnapshotRequest('1.1.1.1', T)).toBe(false);
    expect(allowPublicSnapshotRequest('1.1.1.1', T + WINDOW)).toBe(true);
  });
});
