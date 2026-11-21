// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apertureConfig } from '../../aperture.config';
import {
  __userApiProjectionCacheSize,
  clearUserApiProjections,
  getUserApiProjection,
  userApiProjectionKey,
  type UserApiProjectionLoader,
} from '@/lib/userApi/cache';
import type { BlackoutViewer, UserApiPayload } from '@/types';

// DB-free: the loader is injected and `now` is pinned, so TTL, coalescing,
// eviction and the clear are deterministic.

const TTL = apertureConfig.USER_API_PROJECTION_TTL_MS;
const MAX_ENTRIES = apertureConfig.USER_API_PROJECTION_CACHE_MAX_ENTRIES;
const T = 1_000_000;

const OPEN: BlackoutViewer = { active: false, cleared: false, userId: 7 };
const RESTRICTED: BlackoutViewer = { active: true, cleared: false, userId: 7 };
const RESTRICTED_OTHER: BlackoutViewer = { active: true, cleared: false, userId: 8 };
const CLEARED: BlackoutViewer = { active: true, cleared: true, userId: 7 };

function pilotsPayload(name: string): UserApiPayload {
  return {
    data: [
      {
        characterId: '1',
        characterName: name,
        mainCharacterId: null,
        mainCharacterName: null,
        systemId: 31000001,
        systemName: 'J100001',
        systemSecurity: 'C3',
        systemTrueSec: -1,
        shipTypeId: null,
        shipTypeName: null,
        shipClass: null,
        shipName: null,
        locationAt: '2026-11-21T00:00:00.000Z',
      },
    ],
  };
}

function counting(make: (n: number) => UserApiPayload = (n) => pilotsPayload(`p${n}`)) {
  let calls = 0;
  const load = vi.fn<UserApiProjectionLoader>(async () => make(++calls));
  return { load, calls: () => calls };
}

beforeEach(() => {
  clearUserApiProjections();
});

describe('userApiProjectionKey', () => {
  it('keys viewer-independent resources by map and resource only', () => {
    for (const resource of ['map', 'signatures', 'notes'] as const) {
      expect(userApiProjectionKey(5n, resource, OPEN)).toBe(`5:${resource}`);
      expect(userApiProjectionKey(5n, resource, RESTRICTED)).toBe(`5:${resource}`);
    }
  });

  it('adds full or own:<userId> visibility for pilots and mass_log', () => {
    for (const resource of ['pilots', 'mass_log'] as const) {
      expect(userApiProjectionKey(5n, resource, OPEN)).toBe(`5:${resource}:full`);
      expect(userApiProjectionKey(5n, resource, CLEARED)).toBe(`5:${resource}:full`);
      expect(userApiProjectionKey(5n, resource, RESTRICTED)).toBe(`5:${resource}:own:7`);
      expect(userApiProjectionKey(5n, resource, RESTRICTED_OTHER)).toBe(`5:${resource}:own:8`);
    }
  });
});

describe('getUserApiProjection', () => {
  it('coalesces concurrent misses for one key onto one load', async () => {
    const { load } = counting();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => getUserApiProjection(1n, 'pilots', OPEN, T, load)),
    );
    expect(load).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toBe(results[0]);
  });

  it('loads separately for distinct keys', async () => {
    const { load } = counting();
    await Promise.all([
      getUserApiProjection(1n, 'pilots', OPEN, T, load),
      getUserApiProjection(1n, 'pilots', RESTRICTED, T, load),
      getUserApiProjection(1n, 'pilots', RESTRICTED_OTHER, T, load),
      getUserApiProjection(2n, 'pilots', OPEN, T, load),
    ]);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('serves a hit inside the TTL and reloads after it', async () => {
    const { load } = counting();
    const first = await getUserApiProjection(1n, 'pilots', OPEN, T, load);
    const hit = await getUserApiProjection(1n, 'pilots', OPEN, T + TTL - 1, load);
    expect(hit).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    const reloaded = await getUserApiProjection(1n, 'pilots', OPEN, T + TTL, load);
    expect(reloaded).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('builds the success body and a weak ETag that follows the payload, not the clock', async () => {
    const same = vi.fn<UserApiProjectionLoader>(async () => pilotsPayload('x'));
    const a = await getUserApiProjection(1n, 'pilots', OPEN, T, same);
    expect(JSON.parse(a.body)).toEqual({ ok: true, data: a.payload.data, generatedAt: a.generatedAt });
    expect(a.generatedAt).toBe(new Date(T).toISOString());
    expect(a.etag).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);

    const b = await getUserApiProjection(1n, 'pilots', OPEN, T + TTL, same);
    expect(b.generatedAt).not.toBe(a.generatedAt);
    expect(b.etag).toBe(a.etag);

    const changed = await getUserApiProjection(
      1n,
      'pilots',
      OPEN,
      T + 2 * TTL,
      async () => pilotsPayload('y'),
    );
    expect(changed.etag).not.toBe(a.etag);
  });

  it('serialises a hidden mass log with the hidden marker', async () => {
    const entry = await getUserApiProjection(1n, 'mass_log', RESTRICTED, T, async () => ({
      data: [],
      hidden: true,
    }));
    expect(JSON.parse(entry.body)).toEqual({
      ok: true,
      data: [],
      hidden: true,
      generatedAt: new Date(T).toISOString(),
    });
  });

  it('caches nothing when the load rejects, and propagates', async () => {
    const failing = vi.fn<UserApiProjectionLoader>(async () => {
      throw new Error('boom');
    });
    await expect(getUserApiProjection(1n, 'map', OPEN, T, failing)).rejects.toThrow('boom');
    expect(__userApiProjectionCacheSize()).toBe(0);
    const { load } = counting();
    await getUserApiProjection(1n, 'map', OPEN, T, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used entry past the size cap', async () => {
    const { load } = counting();
    for (let i = 0; i < MAX_ENTRIES; i += 1) {
      await getUserApiProjection(BigInt(i), 'map', OPEN, T, load);
    }
    // Touch map 0 so map 1 becomes the least recently used.
    await getUserApiProjection(0n, 'map', OPEN, T, load);
    await getUserApiProjection(BigInt(MAX_ENTRIES), 'map', OPEN, T, load);
    expect(__userApiProjectionCacheSize()).toBe(MAX_ENTRIES);

    const before = load.mock.calls.length;
    await getUserApiProjection(0n, 'map', OPEN, T, load);
    expect(load.mock.calls.length).toBe(before);
    await getUserApiProjection(1n, 'map', OPEN, T, load);
    expect(load.mock.calls.length).toBe(before + 1);
  });
});

describe('clearUserApiProjections', () => {
  it('empties the cache so the next read reloads', async () => {
    const { load } = counting();
    await getUserApiProjection(1n, 'map', OPEN, T, load);
    await getUserApiProjection(1n, 'pilots', OPEN, T, load);
    expect(__userApiProjectionCacheSize()).toBe(2);
    clearUserApiProjections();
    expect(__userApiProjectionCacheSize()).toBe(0);
    await getUserApiProjection(1n, 'map', OPEN, T, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('stops a load already in flight from caching its result', async () => {
    let release!: (p: UserApiPayload) => void;
    const slow = vi.fn<UserApiProjectionLoader>(
      () => new Promise<UserApiPayload>((resolve) => (release = resolve)),
    );
    const pending = getUserApiProjection(1n, 'pilots', OPEN, T, slow);
    clearUserApiProjections();
    release(pilotsPayload('stale'));
    await pending;
    expect(__userApiProjectionCacheSize()).toBe(0);

    const { load } = counting();
    await getUserApiProjection(1n, 'pilots', OPEN, T, load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
