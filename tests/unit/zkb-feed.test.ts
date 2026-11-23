import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

// The feed's index query, pg_notify and killmail persistence all go through
// `@/db/client`; mock it so the loop logic can be exercised without a database.
// `loadActiveSystemIndex` awaits `db.select(...).from(...).innerJoin(...).where(...)`;
// `notify` awaits `db.execute(...)`; persistence awaits
// `db.insert(...).values(row).onConflictDoNothing()`.
const INDEX_ROWS = [{ systemId: 30000142, mapId: 1n }];
const { values } = vi.hoisted(() => ({ values: vi.fn() }));
vi.mock('@/db/client', () => {
  const where = vi.fn(async () => INDEX_ROWS);
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));
  const execute = vi.fn(async () => ({ rows: [] }));
  values.mockImplementation(() => ({ onConflictDoNothing: vi.fn(async () => undefined) }));
  const insert = vi.fn(() => ({ values }));
  return { db: { select, execute, insert } };
});

// Capture warns/infos so the seed-failure path can assert `zkb.seed_failed` and
// the freshness guard can assert `zkb.stale_skipped`. Hoisted because
// `zkbFeed.ts` binds its logger at import time, before this line.
const { warn, info } = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/log/logger', () => ({
  getLogger: () => ({ debug: vi.fn(), info, warn, error: vi.fn(), fatal: vi.fn() }),
}));

import { apertureConfig } from '../../aperture.config';
import { db } from '@/db/client';
import {
  __resetZkbFeedState,
  correlateKill,
  pollOnce,
  type SystemIndex,
} from '@/lib/integrations/zkbFeed';
import { killmailSchema } from '@/lib/esi/decoders';
import type { ZkbKill } from '@/lib/integrations/zkb';
import type { NewUniverseKillmail } from '@/types';
import { r2z2Kill } from '../fixtures/zkbR2z2';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
  __resetZkbFeedState();
});

/** Serves the live seed at sequence 100, then `entries` from 101 upward, then 404s. */
function feedOf(...entries: unknown[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/sequence.json')) return jsonResponse({ sequence: 100 });
    const seq = Number(url.match(/\/(\d+)\.json$/)?.[1]);
    const entry = entries[seq - 101];
    return entry === undefined ? new Response('', { status: 404 }) : jsonResponse(entry);
  }) as unknown as typeof fetch;
}

const insertedRows = (): NewUniverseKillmail[] => values.mock.calls.map(([row]) => row as NewUniverseKillmail);

describe('correlateKill', () => {
  const index: SystemIndex = new Map([[30000142, new Set([1n, 7n])]]);

  it('emits one notification per active map watching the kill system', () => {
    const kill = {
      killmail_id: 555,
      solar_system_id: 30000142,
      victim: { ship_type_id: 587 },
      zkb: { totalValue: 8_000_000 },
    } as ZkbKill;

    const out = correlateKill(kill, index);
    expect(out).toHaveLength(2);
    expect(out.map((n) => n.mapId).sort()).toEqual([1, 7]);
    expect(out[0]).toMatchObject({
      systemId: 30000142,
      kind: 'killmail',
      killmail: {
        killmailId: 555,
        shipTypeId: 587,
        totalValue: 8_000_000,
        href: 'https://zkillboard.com/kill/555/',
      },
    });
  });

  it('emits nothing for a system on no active map', () => {
    const kill = { killmail_id: 9, solar_system_id: 30002053 } as ZkbKill;
    expect(correlateKill(kill, index)).toEqual([]);
  });

  it('emits nothing when the kill has no solar system', () => {
    const kill = { killmail_id: 9 } as ZkbKill;
    expect(correlateKill(kill, index)).toEqual([]);
  });
});

describe('pollOnce', () => {
  it('seeds the cursor live on the first sweep without processing kills', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ sequence: 100 })) as unknown as typeof fetch;

    const result = await pollOnce();
    expect(result).toEqual({ processed: 0, notified: 0, persisted: 0, cursor: 100 });
    expect(db.execute as Mock).not.toHaveBeenCalled();
  });

  it('walks sequences from the cursor, notifies matches, and stops at a 404', async () => {
    const kill = {
      killmail_id: 555,
      killmail_time: new Date().toISOString(),
      solar_system_id: 30000142,
      victim: { ship_type_id: 587 },
      zkb: { totalValue: 8_000_000 },
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sequence.json')) return jsonResponse({ sequence: 100 });
      if (url.endsWith('/101.json')) return jsonResponse(kill);
      return new Response('', { status: 404 }); // 102 not yet published → caught up
    }) as unknown as typeof fetch;

    await pollOnce(); // seed cursor = 100
    const result = await pollOnce();

    expect(result.processed).toBe(1);
    expect(result.notified).toBe(1);
    expect(result.cursor).toBe(101); // not advanced past the 404'd 102
    expect(db.execute as Mock).toHaveBeenCalledTimes(1);
  });

  it('leaves the cursor null on a failed seed and re-seeds live (never from 0) next tick', async () => {
    const kill = { killmail_id: 555, solar_system_id: 30000142 };
    let seedAttempt = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sequence.json')) {
        // First seed 500s (body null → parse fails); the retry succeeds live.
        return ++seedAttempt === 1 ? new Response('', { status: 500 }) : jsonResponse({ sequence: 100 });
      }
      if (url.endsWith('/101.json')) return jsonResponse(kill);
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

    const failed = await pollOnce();
    expect(failed).toEqual({ processed: 0, notified: 0, persisted: 0, cursor: null });
    expect(warn).toHaveBeenCalledWith('zkb.seed_failed', { status: 500 });

    // Next tick must re-seed from the live sequence, NOT walk from a 0 cursor.
    const seeded = await pollOnce();
    expect(seeded).toEqual({ processed: 0, notified: 0, persisted: 0, cursor: 100 });
    expect(db.execute as Mock).not.toHaveBeenCalled();
  });

  it('leaves the cursor null when the seed body has the wrong shape', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sequence.json')) return jsonResponse({ notSequence: true });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

    const result = await pollOnce();
    expect(result).toEqual({ processed: 0, notified: 0, persisted: 0, cursor: null });
    expect(warn).toHaveBeenCalledWith('zkb.seed_failed', { status: 200 });
  });

  it('decodes and notifies the R2Z2 ephemeral shape (killmail nested under `esi`)', async () => {
    // R2Z2 wraps the ESI killmail under `esi` with `zkb` alongside at the top
    // level — solar_system_id is NOT at the top level. Regression: this shape
    // previously decoded to a system-less kill and fanned no notification.
    const ephemeral = r2z2Kill();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sequence.json')) return jsonResponse({ sequence: 100 });
      if (url.endsWith('/101.json')) return jsonResponse(ephemeral);
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

    await pollOnce(); // seed cursor = 100
    const result = await pollOnce();

    expect(result.processed).toBe(1);
    expect(result.notified).toBe(1);
    expect(db.execute as Mock).toHaveBeenCalledTimes(1);
  });

  it('skips a stale kill (older than the max age) but notifies a fresh one in the same tick', async () => {
    const stale = {
      killmail_id: 134704737,
      killmail_time: new Date(Date.now() - apertureConfig.ZKB_FEED_MAX_KILL_AGE_MS - 60_000).toISOString(),
      solar_system_id: 30000142,
    };
    const fresh = {
      killmail_id: 555,
      killmail_time: new Date().toISOString(),
      solar_system_id: 30000142,
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sequence.json')) return jsonResponse({ sequence: 100 });
      if (url.endsWith('/101.json')) return jsonResponse(stale);
      if (url.endsWith('/102.json')) return jsonResponse(fresh);
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

    await pollOnce(); // seed cursor = 100
    const result = await pollOnce();

    // Both sequences are consumed (cursor advances past the stale one), but only
    // the fresh kill fans out.
    expect(result.processed).toBe(2);
    expect(result.notified).toBe(1);
    expect(result.cursor).toBe(102);
    expect(db.execute as Mock).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      'zkb.stale_skipped',
      expect.objectContaining({ killmailId: 134704737 }),
    );
  });

  it('drops a kill with a missing killmail_time rather than flashing it', async () => {
    const undated = { killmail_id: 999, solar_system_id: 30000142 };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sequence.json')) return jsonResponse({ sequence: 100 });
      if (url.endsWith('/101.json')) return jsonResponse(undated);
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

    await pollOnce(); // seed cursor = 100
    const result = await pollOnce();

    expect(result.processed).toBe(1);
    expect(result.notified).toBe(0);
    expect(db.execute as Mock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('zkb.stale_skipped', { killmailId: 999, ageMs: null });
  });
});

describe('pollOnce killmail persistence', () => {
  it('persists an on-map R2Z2 kill as a cache row killmailSchema parses', async () => {
    globalThis.fetch = feedOf(r2z2Kill());
    await pollOnce();
    const result = await pollOnce();

    expect(result).toMatchObject({ processed: 1, notified: 1, persisted: 1 });
    const [row] = insertedRows();
    expect(row).toMatchObject({ id: 555n, hash: 'abc', totalValue: 8_000_000 });
    expect(row!.killmailTime).toBeInstanceOf(Date);
    const body = killmailSchema.parse(row!.body);
    expect(body.solar_system_id).toBe(30000142);
    expect(body).not.toHaveProperty('zkb');
  });

  it('persists a stale on-map kill without flashing it', async () => {
    const old = new Date(Date.now() - apertureConfig.ZKB_FEED_MAX_KILL_AGE_MS - 60_000).toISOString();
    globalThis.fetch = feedOf(r2z2Kill({ killmailTime: old }));
    await pollOnce();
    const result = await pollOnce();

    expect(result).toMatchObject({ processed: 1, notified: 0, persisted: 1 });
    expect(db.execute as Mock).not.toHaveBeenCalled();
  });

  it('skips persistence for a body that fails killmailSchema and still flashes', async () => {
    const entry = r2z2Kill();
    const esi: Partial<typeof entry.esi> = { ...entry.esi };
    delete esi.attackers;
    globalThis.fetch = feedOf({ ...entry, esi });
    await pollOnce();
    const result = await pollOnce();

    expect(result).toMatchObject({ processed: 1, notified: 1, persisted: 0 });
    expect(values).not.toHaveBeenCalled();
    expect(db.execute as Mock).toHaveBeenCalledTimes(1);
  });

  it('skips persistence for a kill with no hash and still flashes', async () => {
    const entry: Partial<ReturnType<typeof r2z2Kill>> = r2z2Kill();
    delete entry.hash;
    globalThis.fetch = feedOf(entry);
    await pollOnce();
    const result = await pollOnce();

    expect(result).toMatchObject({ notified: 1, persisted: 0 });
    expect(values).not.toHaveBeenCalled();
  });

  it('does not persist a kill in a system on no active map', async () => {
    globalThis.fetch = feedOf(r2z2Kill({ systemId: 30002053 }));
    await pollOnce();
    const result = await pollOnce();

    expect(result).toMatchObject({ processed: 1, notified: 0, persisted: 0 });
    expect(values).not.toHaveBeenCalled();
  });

  it('strips the zKB fields from a flat-shape body and reads the hash from the zkb block', async () => {
    const { esi } = r2z2Kill();
    globalThis.fetch = feedOf({ ...esi, zkb: { hash: 'flat-hash', totalValue: 1 } });
    await pollOnce();
    await pollOnce();

    const [row] = insertedRows();
    expect(row).toMatchObject({ hash: 'flat-hash', totalValue: 1 });
    expect(row!.body).not.toHaveProperty('zkb');
  });
});
