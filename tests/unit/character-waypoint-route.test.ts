// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  esiCalls: 0,
  failAfter: Infinity,
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({ characterId: '42', userId: 1 })),
  assertCharacterOwnership: vi.fn(async () => true),
}));

vi.mock('@/lib/esi/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/esi/client')>();
  return {
    ...actual,
    esiCall: vi.fn(async () => {
      h.esiCalls++;
      if (h.esiCalls > h.failAfter) {
        throw new actual.EsiHttpError('setWaypoint', 500, 'ESI error');
      }
      return null;
    }),
  };
});

const { POST } = await import('@/app/api/character/waypoint/route');

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/character/waypoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {} as never,
  );
}

describe('POST /api/character/waypoint', () => {
  beforeEach(() => {
    h.esiCalls = 0;
    h.failAfter = Infinity;
  });

  it('returns pushed count on full sequence success', async () => {
    const res = await post({
      mode: 'sequence',
      characterId: 42,
      waypointSystemIds: [30000142, 30002187, 30002659],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; pushed?: number };
    expect(json).toEqual({ ok: true, pushed: 3 });
  });

  it('stops on first ESI error and reports partial pushed count', async () => {
    h.failAfter = 1;
    const res = await post({
      mode: 'sequence',
      characterId: 42,
      waypointSystemIds: [30000142, 30002187],
    });
    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: string; pushed?: number };
    expect(json.ok).toBe(false);
    expect(json.pushed).toBe(1);
  });
});