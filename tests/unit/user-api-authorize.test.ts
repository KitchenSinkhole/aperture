// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { apertureConfig } from '../../aperture.config';
import {
  checkUserApiScope,
  clearUserApiAuthCache,
  decideUserApiAccess,
  effectiveUserApiScopes,
  invalidateUserApiAccount,
  invalidateUserApiMap,
  invalidateUserApiToken,
  resolveUserApiToken,
} from '@/lib/userApi/authorize';
import {
  generateUserApiToken,
  hashUserApiToken,
  parseUserApiBearer,
  redactUserApiTokens,
} from '@/lib/userApi/token';
import { scrubContext } from '@/lib/log/scrub';
import type { UserApiTokenRecord } from '@/types';

// DB-free: the decision is a pure function over a resolved record, and the
// cache takes an injected loader and clock.

const NOW = new Date('2026-11-21T12:00:00.000Z');
const HOUR = 3_600_000;
const before = new Date(NOW.getTime() - HOUR);
const after = new Date(NOW.getTime() + HOUR);

function record(overrides: {
  token?: Partial<UserApiTokenRecord['token']>;
  map?: Partial<UserApiTokenRecord['map']>;
  account?: Partial<UserApiTokenRecord['account']>;
  access?: Partial<NonNullable<UserApiTokenRecord['access']>> | null;
} = {}): UserApiTokenRecord {
  return {
    token: {
      id: 1n,
      mapId: 10n,
      userId: 7,
      label: 'pathfinder bot',
      prefix: 'abcdef',
      scopes: ['map', 'signatures'],
      expiresAt: null,
      revokedAt: null,
      suspendedUntil: null,
      ...overrides.token,
    },
    map: {
      id: 10n,
      name: 'Home chain',
      deletedAt: null,
      apiEnabled: true,
      apiScopes: ['map', 'signatures', 'pilots'],
      ...overrides.map,
    },
    account: {
      userId: 7,
      mainCharacterId: 9001n,
      mainCharacterName: 'Main Pilot',
      apiBlockedAt: null,
      apiBlockedUntil: null,
      apiBlockReason: null,
      ...overrides.account,
    },
    access:
      overrides.access === null
        ? null
        : {
            mainCanView: true,
            mainLoginAllowed: true,
            blackout: { active: false, cleared: false, userId: 7 },
            ...overrides.access,
          },
  };
}

describe('decideUserApiAccess', () => {
  const cases: Array<{
    name: string;
    input: UserApiTokenRecord | null;
    status: 401 | 403 | 200;
    code?: string;
  }> = [
    { name: 'unknown token', input: null, status: 401, code: 'invalid_token' },
    { name: 'revoked token', input: record({ token: { revokedAt: before } }), status: 401, code: 'invalid_token' },
    { name: 'expired token', input: record({ token: { expiresAt: before } }), status: 401, code: 'invalid_token' },
    { name: 'expiring exactly now', input: record({ token: { expiresAt: NOW } }), status: 401, code: 'invalid_token' },
    { name: 'soft-deleted map', input: record({ map: { deletedAt: before } }), status: 401, code: 'invalid_token' },
    {
      name: 'timed account block',
      input: record({ account: { apiBlockedAt: before, apiBlockedUntil: after } }),
      status: 403,
      code: 'account_blocked',
    },
    {
      name: 'indefinite account block',
      input: record({ account: { apiBlockedAt: before, apiBlockedUntil: null } }),
      status: 403,
      code: 'account_blocked',
    },
    {
      name: 'token suspended',
      input: record({ token: { suspendedUntil: after } }),
      status: 403,
      code: 'token_suspended',
    },
    { name: 'map API off', input: record({ map: { apiEnabled: false } }), status: 403, code: 'api_disabled' },
    { name: 'no main', input: record({ account: { mainCharacterId: null } }), status: 403, code: 'access_lost' },
    { name: 'main cannot view the map', input: record({ access: { mainCanView: false } }), status: 403, code: 'access_lost' },
    { name: 'main fails the login gate', input: record({ access: { mainLoginAllowed: false } }), status: 403, code: 'access_lost' },
    { name: 'standing not evaluated', input: record({ access: null }), status: 403, code: 'access_lost' },
    { name: 'live token', input: record(), status: 200 },
    {
      name: 'ended block',
      input: record({ account: { apiBlockedAt: before, apiBlockedUntil: before } }),
      status: 200,
    },
    { name: 'ended suspension', input: record({ token: { suspendedUntil: before } }), status: 200 },
    { name: 'future expiry', input: record({ token: { expiresAt: after } }), status: 200 },
  ];

  it.each(cases)('$name', ({ input, status, code }) => {
    const decision = decideUserApiAccess(input, NOW);
    if (status === 200) {
      expect(decision.ok).toBe(true);
      return;
    }
    expect(decision).toMatchObject({ ok: false, status, code });
  });

  it('carries no record on any 401, so the four causes are indistinguishable', () => {
    for (const input of [
      null,
      record({ token: { revokedAt: before } }),
      record({ token: { expiresAt: before } }),
      record({ map: { deletedAt: before } }),
    ]) {
      expect(decideUserApiAccess(input, NOW)).toEqual({
        ok: false,
        status: 401,
        code: 'invalid_token',
        record: null,
      });
    }
  });

  it('gives a suspension a Retry-After rounded up to whole seconds', () => {
    const decision = decideUserApiAccess(
      record({ token: { suspendedUntil: new Date(NOW.getTime() + 1_500) } }),
      NOW,
    );
    expect(decision).toMatchObject({ code: 'token_suspended', retryAfterSec: 2 });
  });

  it('applies the rows in table order', () => {
    const everything = record({
      account: { apiBlockedAt: before, apiBlockedUntil: null, mainCharacterId: null },
      token: { suspendedUntil: after },
      map: { apiEnabled: false },
    });
    expect(decideUserApiAccess(everything, NOW)).toMatchObject({ code: 'account_blocked' });
    expect(
      decideUserApiAccess(
        record({ token: { suspendedUntil: after }, map: { apiEnabled: false } }),
        NOW,
      ),
    ).toMatchObject({ code: 'token_suspended' });
    expect(
      decideUserApiAccess(
        record({ map: { apiEnabled: false }, access: { mainCanView: false } }),
        NOW,
      ),
    ).toMatchObject({ code: 'api_disabled' });
  });
});

describe('effective scopes', () => {
  it('is the intersection of the token and the map, in enum order', () => {
    const r = record({
      token: { scopes: ['signatures', 'kills', 'map', 'notes'] },
      map: { apiScopes: ['notes', 'map', 'pilots'] },
    });
    expect(effectiveUserApiScopes(r)).toEqual(['map', 'notes']);
  });

  it('refuses a scope the map has stopped exposing', () => {
    const r = record({ token: { scopes: ['map', 'pilots'] }, map: { apiScopes: ['map'] } });
    expect(checkUserApiScope(r, 'map').ok).toBe(true);
    expect(checkUserApiScope(r, 'pilots')).toMatchObject({
      ok: false,
      status: 403,
      code: 'scope_not_granted',
    });
  });

  it('refuses a scope the map exposes but the token was not minted with', () => {
    const r = record({ token: { scopes: ['map'] }, map: { apiScopes: ['map', 'pilots'] } });
    expect(checkUserApiScope(r, 'pilots')).toMatchObject({ code: 'scope_not_granted' });
  });
});

describe('token format', () => {
  it('generates an apu_ token whose hash and prefix derive from it', () => {
    const { token, hash, prefix } = generateUserApiToken();
    expect(token).toMatch(/^apu_[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashUserApiToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prefix).toBe(token.slice(4, 10));
    expect(generateUserApiToken().token).not.toBe(token);
  });

  it('parses only a well-formed bearer header', () => {
    const { token } = generateUserApiToken();
    expect(parseUserApiBearer(`Bearer ${token}`)).toBe(token);
    expect(parseUserApiBearer(`bearer ${token}`)).toBe(token);
    expect(parseUserApiBearer(null)).toBeNull();
    expect(parseUserApiBearer('')).toBeNull();
    expect(parseUserApiBearer(`Basic ${token}`)).toBeNull();
    expect(parseUserApiBearer(token)).toBeNull();
    expect(parseUserApiBearer('Bearer apu_short')).toBeNull();
    expect(parseUserApiBearer(`Bearer ${token}x`)).toBeNull();
    expect(parseUserApiBearer(`Bearer ${token.replace('apu_', 'apx_')}`)).toBeNull();
    expect(parseUserApiBearer(`Bearer ${token} extra`)).toBeNull();
  });
});

describe('log scrubbing', () => {
  it('redacts tokens wherever they appear in a context', () => {
    const { token } = generateUserApiToken();
    const out = scrubContext({
      header: `Bearer ${token}`,
      nested: { list: [`x ${token} y`] },
      err: new Error(`bad token ${token}`),
      mapId: '10',
    }) as Record<string, unknown>;
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain(token);
    expect(out.header).toBe('Bearer apu_[redacted]');
    expect(out.mapId).toBe('10');
    expect((out.err as { message: string }).message).toBe('bad token apu_[redacted]');
  });

  it('redacts a token with characters glued to its end whole', () => {
    const { token } = generateUserApiToken();
    expect(redactUserApiTokens(`${token}abc.`)).toBe('apu_[redacted].');
    expect(redactUserApiTokens('apu_ is the prefix')).toBe('apu_ is the prefix');
  });
});

describe('resolveUserApiToken cache', () => {
  const TTL = apertureConfig.USER_API_AUTH_CACHE_TTL_MS;
  const T = 1_000_000;

  beforeEach(() => clearUserApiAuthCache());

  function countingLoader(value: () => UserApiTokenRecord | null) {
    const calls = { n: 0 };
    const load = async () => {
      calls.n += 1;
      return value();
    };
    return { calls, load };
  }

  it('serves a hit within the TTL and reloads after it', async () => {
    const { calls, load } = countingLoader(() => record());
    await resolveUserApiToken('h', T, load);
    await resolveUserApiToken('h', T + TTL - 1, load);
    expect(calls.n).toBe(1);
    await resolveUserApiToken('h', T + TTL, load);
    expect(calls.n).toBe(2);
  });

  it('caches a miss', async () => {
    const { calls, load } = countingLoader(() => null);
    expect(await resolveUserApiToken('nope', T, load)).toBeNull();
    expect(await resolveUserApiToken('nope', T + 1, load)).toBeNull();
    expect(calls.n).toBe(1);
  });

  it('coalesces concurrent misses onto one load', async () => {
    const { calls, load } = countingLoader(() => record());
    await Promise.all([1, 2, 3].map(() => resolveUserApiToken('h', T, load)));
    expect(calls.n).toBe(1);
  });

  it('does not cache a rejected load', async () => {
    let fail = true;
    const load = async () => {
      if (fail) throw new Error('db down');
      return record();
    };
    await expect(resolveUserApiToken('h', T, load)).rejects.toThrow('db down');
    fail = false;
    expect(await resolveUserApiToken('h', T + 1, load)).not.toBeNull();
  });

  it.each([
    ['token', () => invalidateUserApiToken(1n), () => invalidateUserApiToken(2n)],
    ['map', () => invalidateUserApiMap(10n), () => invalidateUserApiMap(11n)],
    ['account', () => invalidateUserApiAccount(7), () => invalidateUserApiAccount(8)],
    ['everything', () => clearUserApiAuthCache(), null],
  ] as const)('invalidates by %s', async (_name, hit, miss) => {
    const { calls, load } = countingLoader(() => record());
    await resolveUserApiToken('h', T, load);
    if (miss) {
      miss();
      await resolveUserApiToken('h', T + 1, load);
      expect(calls.n).toBe(1);
    }
    hit();
    await resolveUserApiToken('h', T + 2, load);
    expect(calls.n).toBe(2);
  });

  it('does not cache a load that was in flight across an invalidation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls = { n: 0 };
    const load = async () => {
      calls.n += 1;
      await gate;
      return record();
    };
    const pending = resolveUserApiToken('h', T, load);
    invalidateUserApiToken(1n);
    release();
    await pending;
    await resolveUserApiToken('h', T + 1, load);
    expect(calls.n).toBe(2);
  });

  it('evicts the least recently used entry past the size cap', async () => {
    const MAX = apertureConfig.USER_API_AUTH_CACHE_MAX_ENTRIES;
    const { calls, load } = countingLoader(() => null);
    for (let i = 0; i <= MAX; i += 1) await resolveUserApiToken(`k${i}`, T, load);
    expect(calls.n).toBe(MAX + 1);
    await resolveUserApiToken(`k${MAX}`, T + 1, load);
    expect(calls.n).toBe(MAX + 1);
    await resolveUserApiToken('k0', T + 1, load);
    expect(calls.n).toBe(MAX + 2);
  });
});
