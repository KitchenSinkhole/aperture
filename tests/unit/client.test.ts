import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sonner runs in a browser env; stub it here so the helpers stay testable.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from 'sonner';
import {
  addSystemOnServer,
  deleteSignatureOnServer,
  removeSystemOnServer,
  updateSystemOnServer,
} from '@/lib/map/client';

type FetchArgs = { url: string; init: RequestInit | undefined };

const originalFetch = globalThis.fetch;

function mockFetch(...responses: Array<{ status?: number; body: unknown }>): {
  calls: FetchArgs[];
} {
  const calls: FetchArgs[] = [];
  let i = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[i++] ?? responses[responses.length - 1];
    return new Response(JSON.stringify(next!.body), {
      status: next!.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('client.ts — mutationFetch success', () => {
  it('returns the server payload on 200', async () => {
    mockFetch({
      body: {
        ok: true,
        data: { kind: 'system.removed', eventId: 7, id: '11' },
        eventId: 7,
      },
    });
    const result = await removeSystemOnServer({ mapId: '1', mapSystemId: '11' });
    expect(result).toEqual({
      ok: true,
      data: { kind: 'system.removed', eventId: 7, id: '11' },
      eventId: 7,
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('sends method + URL + JSON body for PATCH', async () => {
    const { calls } = mockFetch({
      body: {
        ok: true,
        data: { kind: 'system.updated', eventId: 8, id: '11', alias: 'Home' },
        eventId: 8,
      },
    });
    await updateSystemOnServer({ mapId: '1', mapSystemId: '11', patch: { alias: 'Home' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/map/1/systems/11');
    expect(calls[0]!.init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ alias: 'Home' });
  });
});

describe('client.ts — mutationFetch failure', () => {
  it('folds an explicit { ok: false } body into the result and toasts the error', async () => {
    mockFetch({ status: 400, body: { ok: false, error: 'Invalid input.' } });
    const result = await addSystemOnServer({ mapId: '1', systemId: 30000142 });
    expect(result).toEqual({ ok: false, error: 'Invalid input.' });
    expect(toast.error).toHaveBeenCalledWith('Invalid input.');
  });

  it('handles a non-JSON body with a synthesised error', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    const result = await deleteSignatureOnServer({ mapId: '1', signatureId: '30' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('500');
    expect(toast.error).toHaveBeenCalled();
  });

  it('surfaces a network throw as a failure with toast', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const result = await removeSystemOnServer({ mapId: '1', mapSystemId: '11' });
    expect(result).toEqual({ ok: false, error: 'offline' });
    expect(toast.error).toHaveBeenCalledWith('offline');
  });
});

describe('client.ts — fetchWormholeCatalog', () => {
  // The catalog promise is memoized at module scope; reset modules so each test
  // starts with a cold cache and a fresh dynamic import of the helper.
  beforeEach(() => {
    vi.resetModules();
  });

  it('GETs the global catalog route and returns the data array', async () => {
    const { calls } = mockFetch({
      body: {
        ok: true,
        data: [
          { typeId: 1, name: 'A239', sourceClasses: ['C3'], targetClass: null, jumpMassClass: 'l' },
        ],
      },
    });
    const { fetchWormholeCatalog } = await import('@/lib/map/client');
    const result = await fetchWormholeCatalog();
    expect(result).toEqual({
      ok: true,
      data: [
        { typeId: 1, name: 'A239', sourceClasses: ['C3'], targetClass: null, jumpMassClass: 'l' },
      ],
    });
    expect(calls[0]!.url).toContain('/api/wormhole-types');
  });

  it('memoizes session-wide — concurrent + repeat calls hit the network once', async () => {
    const { calls } = mockFetch({
      body: {
        ok: true,
        data: [
          { typeId: 9, name: 'K162', sourceClasses: null, targetClass: null, jumpMassClass: null },
        ],
      },
    });
    const { fetchWormholeCatalog } = await import('@/lib/map/client');
    // Concurrent burst (N dropdowns mounting at once) shares one in-flight request.
    const [first, second] = await Promise.all([fetchWormholeCatalog(), fetchWormholeCatalog()]);
    const third = await fetchWormholeCatalog();
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(calls).toHaveLength(1);
  });

  it('evicts on failure so a later call retries', async () => {
    const { calls } = mockFetch(
      { status: 500, body: { ok: false, error: 'boom' } },
      { body: { ok: true, data: [] } },
    );
    const { fetchWormholeCatalog } = await import('@/lib/map/client');
    const failed = await fetchWormholeCatalog();
    expect(failed.ok).toBe(false);
    const retried = await fetchWormholeCatalog();
    expect(retried).toEqual({ ok: true, data: [] });
    expect(calls).toHaveLength(2);
  });
});
