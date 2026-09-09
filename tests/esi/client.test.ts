// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Token resolution touches the DB and crypto; mock both so the client tests are
// deterministic and DB-free. `tokenRow` is mutated per-test to drive the
// character-auth path.
const { tokenRow } = vi.hoisted(() => ({
  tokenRow: { value: null as { accessToken: string | null; expires: Date | null } | null },
}));

vi.mock('@/db/client', () => {
  const builder = {
    from: () => builder,
    where: () => Promise.resolve([tokenRow.value]),
  };
  return { db: { select: () => builder }, pool: { end: vi.fn() } };
});

vi.mock('@/lib/crypto', () => ({
  decryptToken: (blob: string) => `plain:${blob}`,
  encryptToken: (s: string) => s,
}));

// The forced-refresh-on-401 path delegates to the provider; mock it so the
// client tests stay DB-free and deterministic. Returns a fresh plaintext token.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('@/lib/auth/eve-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/eve-provider')>()),
  refreshAccessToken: refreshMock,
}));

import {
  esiCall,
  EsiBreakerOpenError,
  EsiDecodeError,
  EsiDowntimeError,
  EsiHttpError,
  EsiRateLimitError,
  EsiTokenError,
  EsiTokenTransientError,
} from '@/lib/esi/client';
import { SsoRefreshError } from '@/lib/auth/eve-provider';
import { statusSchema } from '@/lib/esi/decoders';
import { __resetBreakersForTest, breakerState } from '@/lib/esi/breaker';
import { resolveRoute, __resetRouteIndexForTest } from '@/lib/esi/routes';

const NON_DOWNTIME = new Date('2026-01-01T00:00:00Z');
const DOWNTIME = new Date('2026-01-01T11:00:00Z');

const VALID_STATUS = { players: 30000, server_version: '1.2.3', start_time: '2026-01-01T11:05:00Z' };

function statusResponse(init?: ResponseInit) {
  return new Response(JSON.stringify(VALID_STATUS), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  __resetBreakersForTest();
  vi.useFakeTimers();
  vi.setSystemTime(NON_DOWNTIME);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  tokenRow.value = null;
  refreshMock.mockReset();
});

/** A character token row far enough from expiry to take the decrypt (no-refresh) path. */
function freshTokenRow() {
  tokenRow.value = {
    accessToken: 'stored-token',
    expires: new Date(NON_DOWNTIME.getTime() + 60 * 60 * 1000),
  };
}

describe('routes resolver', () => {
  it('resolves an operationId to method + path from swagger', () => {
    __resetRouteIndexForTest();
    expect(resolveRoute('GetStatus')).toMatchObject({ method: 'get', path: '/status' });
  });

  it('throws loudly for an unknown operationId', () => {
    expect(() => resolveRoute('not_a_real_op')).toThrow(/no openapi operation/i);
  });
});

describe('esiCall — decoding', () => {
  it('returns the decoded body on a valid 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => statusResponse()));
    const status = await esiCall('getStatus', { schema: statusSchema });
    expect(status.players).toBe(30000);
  });

  it('throws EsiDecodeError when the body drifts from the schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ players: 'lots' }), { status: 200 })));
    await expect(esiCall('getStatus', { schema: statusSchema })).rejects.toBeInstanceOf(EsiDecodeError);
  });

  it('sends datasource and a User-Agent', async () => {
    const fetchMock = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => statusResponse(),
    );
    vi.stubGlobal('fetch', fetchMock);
    await esiCall('getStatus', { schema: statusSchema });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('datasource=tranquility');
    expect((init!.headers as Record<string, string>)['User-Agent']).toBeTruthy();
  });
});

describe('esiCall — circuit breaker', () => {
  it('opens after the failure threshold and short-circuits further calls', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 5; i++) {
      await expect(esiCall('getStatus', { schema: statusSchema })).rejects.toBeInstanceOf(EsiHttpError);
    }
    expect(breakerState('GetStatus')).toBe('open');

    const callsBefore = fetchMock.mock.calls.length;
    await expect(esiCall('getStatus', { schema: statusSchema })).rejects.toBeInstanceOf(EsiBreakerOpenError);
    expect(fetchMock.mock.calls.length).toBe(callsBefore); // request was not sent
  });

  it('half-opens after cooldown and closes on a successful trial', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async () => (fail ? new Response('boom', { status: 500 }) : statusResponse())));

    for (let i = 0; i < 5; i++) {
      await expect(esiCall('getStatus', { schema: statusSchema })).rejects.toBeInstanceOf(EsiHttpError);
    }
    expect(breakerState('GetStatus')).toBe('open');

    fail = false;
    vi.advanceTimersByTime(60_001); // past ESI_BREAKER_COOLDOWN_MS
    const status = await esiCall('getStatus', { schema: statusSchema });
    expect(status.players).toBe(30000);
    expect(breakerState('GetStatus')).toBe('closed');
  });
});

describe('esiCall — downtime tolerance', () => {
  it('throws EsiDowntimeError without tripping the breaker inside the window', async () => {
    vi.setSystemTime(DOWNTIME);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));

    for (let i = 0; i < 6; i++) {
      await expect(esiCall('getStatus', { schema: statusSchema })).rejects.toBeInstanceOf(EsiDowntimeError);
    }
    expect(breakerState('GetStatus')).toBe('closed');
  });
});

describe('esiCall — error limit', () => {
  it('throws EsiRateLimitError with the reset window when the budget is exhausted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('limited', {
          status: 420,
          headers: { 'x-esi-error-limit-remain': '0', 'x-esi-error-limit-reset': '42' },
        }),
      ),
    );
    const err = await esiCall('getStatus', { schema: statusSchema }).catch((e) => e);
    expect(err).toBeInstanceOf(EsiRateLimitError);
    expect((err as EsiRateLimitError).resetSeconds).toBe(42);
  });
});

describe('esiCall — character auth', () => {
  it('attaches a Bearer token resolved from the character row', async () => {
    tokenRow.value = {
      accessToken: 'stored-token',
      expires: new Date(NON_DOWNTIME.getTime() + 60 * 60 * 1000), // far from expiry
    };
    const fetchMock = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ solar_system_id: 30000142 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { locationSchema } = await import('@/lib/esi/decoders');
    await esiCall('getCharacterLocation', {
      schema: locationSchema,
      characterId: 90000001n,
      pathParams: { character_id: 90000001 },
    });

    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer plain:stored-token');
  });

  it('requires a characterId for character-auth opKeys', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { locationSchema } = await import('@/lib/esi/decoders');
    await expect(
      esiCall('getCharacterLocation', { schema: locationSchema, pathParams: { character_id: 1 } }),
    ).rejects.toThrow(/requires a characterId/);
  });
});

describe('esiCall — 401 force-refresh + retry', () => {
  const ONLINE_OP = 'get_characters_character_id_online';

  async function callOnline() {
    const { characterOnlineSchema } = await import('@/lib/esi/decoders');
    return esiCall('getCharacterOnline', {
      schema: characterOnlineSchema,
      characterId: 90000001n,
      pathParams: { character_id: 90000001 },
    });
  }

  it('refreshes the token and retries once, succeeding on the second request', async () => {
    freshTokenRow();
    refreshMock.mockResolvedValue('fresh-token');
    let n = 0;
    const fetchMock = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => {
        n += 1;
        return n === 1
          ? new Response('{"error":"token is expired"}', { status: 401 })
          : new Response(JSON.stringify({ online: true }), { status: 200 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOnline();
    expect(result.online).toBe(true);
    expect(refreshMock).toHaveBeenCalledOnce();
    // The retry must carry the freshly-rotated token, not the stale one.
    expect((fetchMock.mock.calls[1]![1]!.headers as Record<string, string>).Authorization).toBe(
      'Bearer fresh-token',
    );
    // A 401 is a token problem — it must not pollute the endpoint breaker.
    expect(breakerState(ONLINE_OP)).toBe('closed');
  });

  it('throws EsiHttpError(401) — not EsiTokenError — when a refreshed token still 401s', async () => {
    freshTokenRow();
    refreshMock.mockResolvedValue('fresh-token');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    const err = await callOnline().catch((e) => e);
    expect(err).toBeInstanceOf(EsiHttpError);
    expect((err as EsiHttpError).status).toBe(401);
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(breakerState(ONLINE_OP)).toBe('closed'); // breaker untouched
  });

  it('surfaces EsiTokenError when SSO rejects the refresh token (dead refresh token)', async () => {
    freshTokenRow();
    refreshMock.mockRejectedValue(
      new SsoRefreshError('EVE SSO token refresh failed: 400', true, 400, 'invalid_grant'),
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    const err = await callOnline().catch((e) => e);
    expect(err).toBeInstanceOf(EsiTokenError);
    expect(breakerState(ONLINE_OP)).toBe('closed');
  });

  it('surfaces EsiTokenTransientError when the SSO endpoint fails the refresh', async () => {
    freshTokenRow();
    refreshMock.mockRejectedValue(
      new SsoRefreshError('EVE SSO token refresh failed: 503', false, 503),
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    const err = await callOnline().catch((e) => e);
    expect(err).toBeInstanceOf(EsiTokenTransientError);
    expect(err).not.toBeInstanceOf(EsiTokenError);
    expect(breakerState(ONLINE_OP)).toBe('closed');
  });

  it('treats an unclassified refresh failure as transient, not token loss', async () => {
    freshTokenRow();
    refreshMock.mockRejectedValue(new Error('socket hang up'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    const err = await callOnline().catch((e) => e);
    expect(err).toBeInstanceOf(EsiTokenTransientError);
  });

  it('classifies a stale-token refresh failure on the expiry-buffer path too', async () => {
    // No 401 involved: the stored token is inside the refresh buffer, so the
    // proactive refresh runs before the request leaves.
    tokenRow.value = { accessToken: 'blob', expires: new Date(Date.now() + 1000) };
    refreshMock.mockRejectedValue(
      new SsoRefreshError('EVE SSO token refresh unreachable', false),
    );
    const fetchMock = vi.fn(async () => statusResponse());
    vi.stubGlobal('fetch', fetchMock);

    const err = await callOnline().catch((e) => e);
    expect(err).toBeInstanceOf(EsiTokenTransientError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
