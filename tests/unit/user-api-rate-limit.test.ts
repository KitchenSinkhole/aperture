// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn<(query: unknown) => Promise<{ rows: unknown[] }>>(async () => ({ rows: [] }));
vi.mock('@/db/client', () => ({
  db: { execute: (q: unknown) => execute(q) },
  pool: { query: vi.fn(), end: vi.fn() },
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  __resetUserApiRateLimit,
  __userApiRateLimitSizes,
  checkUserApiIp,
  consumeUserApiRequest,
  noteUserApiSuspendedRequest,
  recordUserApiAuthFailure,
} from '@/lib/userApi/rateLimit';
import {
  nextUserApiStrike,
  userApiAccountBlockUntil,
  userApiSuspensionMs,
} from '@/lib/userApi/abuse';
import {
  __pendingUserApiUsage,
  __resetUserApiUsage,
  flushUserApiUsage,
  recordUserApiUsage,
} from '@/lib/userApi/usage';
import { apertureConfig } from '../../aperture.config';

const W = apertureConfig.USER_API_RATE_WINDOW_MS;
const PER_TOKEN = apertureConfig.USER_API_MAX_PER_TOKEN;
const PER_ACCOUNT = apertureConfig.USER_API_MAX_PER_ACCOUNT;
const GLOBAL = apertureConfig.USER_API_MAX_GLOBAL;
const PER_IP = apertureConfig.USER_API_MAX_PER_IP;
const AUTH_FAILS = apertureConfig.USER_API_MAX_AUTH_FAILURES_PER_IP;
const STEPS = apertureConfig.USER_API_IP_BLOCK_STEPS_MS;
const HOT = apertureConfig.USER_API_HOT_WINDOW_REJECTS;
const DAY = 86_400_000;

/** A window-aligned clock origin well away from zero. */
const T0 = 1_000 * W;

beforeEach(() => {
  __resetUserApiRateLimit();
  __resetUserApiUsage();
  execute.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function exhaustToken(tokenId: bigint, userId: number, now: number): void {
  for (let i = 0; i < PER_TOKEN; i++) {
    expect(consumeUserApiRequest(tokenId, userId, now).ok).toBe(true);
  }
}

/** Fills one window's budget, then sends `HOT` refusals; returns whether the last one struck. */
function hotWindow(tokenId: bigint, now: number): boolean {
  exhaustToken(tokenId, 1, now);
  let strike = false;
  for (let i = 0; i < HOT; i++) {
    const d = consumeUserApiRequest(tokenId, 1, now);
    if (d.ok) throw new Error('expected a refusal');
    strike = d.strike;
  }
  return strike;
}

describe('checkUserApiIp', () => {
  it('accepts up to the per-IP cap, then refuses until the window rolls', () => {
    for (let i = 0; i < PER_IP; i++) expect(checkUserApiIp('1.1.1.1', T0).ok).toBe(true);
    expect(checkUserApiIp('1.1.1.1', T0 + 30_000)).toEqual({ ok: false, retryAfterSec: 30 });
    expect(checkUserApiIp('2.2.2.2', T0).ok).toBe(true);
    expect(checkUserApiIp('1.1.1.1', T0 + W).ok).toBe(true);
  });
});

describe('recordUserApiAuthFailure', () => {
  it('blocks an IP on the failure past the cap, for the first step', () => {
    for (let i = 0; i < AUTH_FAILS; i++) expect(recordUserApiAuthFailure('9.9.9.9', T0)).toBe(false);
    expect(checkUserApiIp('9.9.9.9', T0).ok).toBe(true);
    expect(recordUserApiAuthFailure('9.9.9.9', T0)).toBe(true);
    expect(checkUserApiIp('9.9.9.9', T0 + 1)).toEqual({
      ok: false,
      retryAfterSec: Math.ceil((STEPS[0]! - 1) / 1000),
    });
    expect(checkUserApiIp('9.9.9.9', T0 + STEPS[0]!).ok).toBe(true);
  });

  it('escalates through the steps for repeat windows, capped at the last', () => {
    let now = T0;
    const blockAgain = () => {
      for (let i = 0; i <= AUTH_FAILS; i++) recordUserApiAuthFailure('9.9.9.9', now);
    };
    for (const step of [...STEPS, STEPS[STEPS.length - 1]!]) {
      blockAgain();
      expect(checkUserApiIp('9.9.9.9', now + step - 1).ok).toBe(false);
      expect(checkUserApiIp('9.9.9.9', now + step).ok).toBe(true);
      now += step;
    }
  });

  it('forgets the step once the longest step has passed since the block ended', () => {
    const memory = Math.max(...STEPS);
    for (let i = 0; i <= AUTH_FAILS; i++) recordUserApiAuthFailure('9.9.9.9', T0);
    const later = T0 + STEPS[0]! + memory;
    for (let i = 0; i <= AUTH_FAILS; i++) recordUserApiAuthFailure('9.9.9.9', later);
    expect(checkUserApiIp('9.9.9.9', later + STEPS[0]! - 1).ok).toBe(false);
    expect(checkUserApiIp('9.9.9.9', later + STEPS[0]!).ok).toBe(true);
  });

  it('counts failures per window', () => {
    for (let i = 0; i < AUTH_FAILS; i++) recordUserApiAuthFailure('9.9.9.9', T0);
    expect(recordUserApiAuthFailure('9.9.9.9', T0 + W)).toBe(false);
    expect(checkUserApiIp('9.9.9.9', T0 + W).ok).toBe(true);
  });
});

describe('consumeUserApiRequest', () => {
  it('accepts up to the token cap and reports the remaining budget and reset', () => {
    const first = consumeUserApiRequest(1n, 1, T0 + 15_000);
    expect(first).toEqual({ ok: true, limit: PER_TOKEN, remaining: PER_TOKEN - 1, resetSec: 45 });
    for (let i = 1; i < PER_TOKEN; i++) consumeUserApiRequest(1n, 1, T0 + 15_000);
    expect(consumeUserApiRequest(1n, 1, T0 + 20_000)).toEqual({
      ok: false,
      limitedBy: 'token',
      limit: PER_TOKEN,
      remaining: 0,
      resetSec: 40,
      retryAfterSec: 40,
      strike: false,
    });
    expect(consumeUserApiRequest(1n, 1, T0 + W).ok).toBe(true);
  });

  it('sums an account over its tokens', () => {
    const tokens = Math.ceil(PER_ACCOUNT / PER_TOKEN) + 1;
    let accepted = 0;
    let refusal: ReturnType<typeof consumeUserApiRequest> | null = null;
    for (let t = 0; t < tokens; t++) {
      for (let i = 0; i < PER_TOKEN; i++) {
        const d = consumeUserApiRequest(BigInt(100 + t), 7, T0);
        if (d.ok) accepted += 1;
        else refusal ??= d;
      }
    }
    expect(accepted).toBe(PER_ACCOUNT);
    expect(refusal).toMatchObject({ ok: false, limitedBy: 'account' });
    expect(consumeUserApiRequest(999n, 8, T0).ok).toBe(true);
  });

  it('applies the global ceiling last', () => {
    let n = 0;
    for (let account = 0; n < GLOBAL; account++) {
      for (let i = 0; i < PER_TOKEN && n < GLOBAL; i++, n++) {
        expect(consumeUserApiRequest(BigInt(10_000 + account), 10_000 + account, T0).ok).toBe(true);
      }
    }
    expect(consumeUserApiRequest(1n, 1, T0)).toMatchObject({ ok: false, limitedBy: 'global' });
  });

  it('does not count refused requests against the budget', () => {
    exhaustToken(1n, 1, T0);
    for (let i = 0; i < 10; i++) consumeUserApiRequest(1n, 1, T0);
    expect(consumeUserApiRequest(2n, 1, T0)).toMatchObject({
      ok: true,
      remaining: PER_TOKEN - 1,
    });
  });
});

describe('hot windows and strikes', () => {
  it('strikes on the third hot window inside the span', () => {
    expect(hotWindow(1n, T0)).toBe(false);
    expect(hotWindow(1n, T0 + W)).toBe(false);
    expect(hotWindow(1n, T0 + 2 * W)).toBe(true);
  });

  it('fires the strike once, on the refusal that completes the window', () => {
    hotWindow(1n, T0);
    hotWindow(1n, T0 + W);
    exhaustToken(1n, 1, T0 + 2 * W);
    const strikes: boolean[] = [];
    for (let i = 0; i < HOT * 2; i++) {
      const d = consumeUserApiRequest(1n, 1, T0 + 2 * W);
      if (!d.ok) strikes.push(d.strike);
    }
    expect(strikes.filter(Boolean)).toHaveLength(1);
    expect(strikes[HOT - 1]).toBe(true);
  });

  it('needs a full window of refusals to be hot', () => {
    exhaustToken(1n, 1, T0);
    for (let i = 0; i < HOT - 1; i++) consumeUserApiRequest(1n, 1, T0);
    hotWindow(1n, T0 + W);
    expect(hotWindow(1n, T0 + 2 * W)).toBe(false);
    expect(hotWindow(1n, T0 + 3 * W)).toBe(true);
  });

  it('drops hot windows older than the span', () => {
    const span = apertureConfig.USER_API_STRIKE_SPAN_MS;
    hotWindow(1n, T0);
    hotWindow(1n, T0 + W);
    expect(hotWindow(1n, T0 + W + span)).toBe(false);
  });

  it('restarts the history after a strike', () => {
    hotWindow(1n, T0);
    hotWindow(1n, T0 + W);
    expect(hotWindow(1n, T0 + 2 * W)).toBe(true);
    expect(hotWindow(1n, T0 + 3 * W)).toBe(false);
    expect(hotWindow(1n, T0 + 4 * W)).toBe(false);
    expect(hotWindow(1n, T0 + 5 * W)).toBe(true);
  });

  it('counts account-cap refusals but not global-ceiling refusals', () => {
    const fillAccount = (now: number) => {
      for (let t = 0; t * PER_TOKEN < PER_ACCOUNT; t++) {
        for (let i = 0; i < PER_TOKEN; i++) consumeUserApiRequest(BigInt(500 + t), 3, now);
      }
    };
    let strike = false;
    for (let w = 0; w < 3; w++) {
      fillAccount(T0 + w * W);
      for (let i = 0; i < HOT; i++) {
        const d = consumeUserApiRequest(1n, 3, T0 + w * W);
        if (!d.ok && d.limitedBy === 'account') strike = d.strike;
      }
    }
    expect(strike).toBe(true);

    __resetUserApiRateLimit();
    const fillGlobal = (now: number) => {
      for (let n = 0, t = 0; n < GLOBAL; t++) {
        for (let i = 0; i < PER_TOKEN && n < GLOBAL; i++, n++) {
          consumeUserApiRequest(BigInt(10_000 + t), 10_000 + t, now);
        }
      }
    };
    for (let w = 0; w < 3; w++) {
      fillGlobal(T0 + w * W);
      for (let i = 0; i < HOT; i++) {
        expect(consumeUserApiRequest(2n, 4, T0 + w * W)).toMatchObject({
          ok: false,
          limitedBy: 'global',
          strike: false,
        });
      }
      expect(__userApiRateLimitSizes(T0 + w * W)).toMatchObject({ rejectsPerToken: 0, hotWindows: 0 });
    }
  });

  it('counts requests sent while suspended', () => {
    let strike = false;
    for (let w = 0; w < 3; w++) {
      for (let i = 0; i < HOT; i++) strike = noteUserApiSuspendedRequest(1n, T0 + w * W);
    }
    expect(strike).toBe(true);
  });
});

describe('memory bounds', () => {
  it('empties every map once its window, span or block memory has rolled', () => {
    checkUserApiIp('1.1.1.1', T0);
    for (let i = 0; i <= AUTH_FAILS; i++) recordUserApiAuthFailure('9.9.9.9', T0);
    recordUserApiAuthFailure('8.8.8.8', T0);
    hotWindow(1n, T0);
    expect(__userApiRateLimitSizes(T0)).toEqual({
      perIp: 1,
      authFailuresPerIp: 1,
      perToken: 1,
      perAccount: 1,
      rejectsPerToken: 1,
      hotWindows: 1,
      ipBlocks: 1,
    });

    expect(__userApiRateLimitSizes(T0 + W)).toMatchObject({
      perIp: 0,
      authFailuresPerIp: 0,
      perToken: 0,
      perAccount: 0,
      rejectsPerToken: 0,
    });

    const span = apertureConfig.USER_API_STRIKE_SPAN_MS;
    expect(__userApiRateLimitSizes(T0 + span)).toMatchObject({ hotWindows: 0 });

    const memory = Math.max(...STEPS);
    expect(__userApiRateLimitSizes(T0 + STEPS[0]! + memory)).toEqual({
      perIp: 0,
      authFailuresPerIp: 0,
      perToken: 0,
      perAccount: 0,
      rejectsPerToken: 0,
      hotWindows: 0,
      ipBlocks: 0,
    });
  });
});

describe('strike arithmetic', () => {
  const now = new Date(T0);

  it('numbers the next strike, decaying after the decay span', () => {
    const decay = apertureConfig.USER_API_STRIKE_DECAY_DAYS * DAY;
    expect(nextUserApiStrike({ strikeCount: 0, lastStrikeAt: null }, now)).toBe(1);
    expect(nextUserApiStrike({ strikeCount: 1, lastStrikeAt: new Date(T0 - DAY) }, now)).toBe(2);
    expect(nextUserApiStrike({ strikeCount: 2, lastStrikeAt: new Date(T0 - decay) }, now)).toBe(3);
    expect(nextUserApiStrike({ strikeCount: 2, lastStrikeAt: new Date(T0 - decay - 1) }, now)).toBe(1);
  });

  it('suspends for strikes 1 and 2 and revokes from strike 3', () => {
    expect(userApiSuspensionMs(1)).toBe(15 * 60_000);
    expect(userApiSuspensionMs(2)).toBe(6 * 3_600_000);
    expect(userApiSuspensionMs(3)).toBeNull();
  });

  it('blocks for the first-offence span, or indefinitely inside the repeat window', () => {
    const repeat = apertureConfig.USER_API_REPEAT_OFFENCE_WINDOW_DAYS * DAY;
    const first = new Date(T0 + apertureConfig.USER_API_FIRST_BLOCK_DAYS * DAY);
    expect(userApiAccountBlockUntil(null, now)).toEqual(first);
    expect(userApiAccountBlockUntil(new Date(T0 - repeat), now)).toBeNull();
    expect(userApiAccountBlockUntil(new Date(T0 - repeat - 1), now)).toEqual(first);
  });
});

describe('usage', () => {
  const dialect = new PgDialect();

  it('flushes every pending tally in one update and empties the buffer', async () => {
    recordUserApiUsage(5n, T0);
    recordUserApiUsage(5n, T0 + 2_000);
    recordUserApiUsage(5n, T0 + 1_000);
    recordUserApiUsage(6n, T0);
    expect(__pendingUserApiUsage()).toBe(2);

    expect(await flushUserApiUsage()).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(__pendingUserApiUsage()).toBe(0);

    const { params } = dialect.sqlToQuery(execute.mock.calls[0]![0] as SQL);
    expect(params).toEqual([
      '5',
      3,
      new Date(T0 + 2_000).toISOString(),
      '6',
      1,
      new Date(T0).toISOString(),
    ]);
  });

  it('writes nothing for an empty buffer', async () => {
    expect(await flushUserApiUsage()).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('flushes at most once per interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    recordUserApiUsage(5n);
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(1);

    recordUserApiUsage(5n);
    recordUserApiUsage(6n);
    await vi.advanceTimersByTimeAsync(apertureConfig.USER_API_USAGE_FLUSH_MS - 1);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(__pendingUserApiUsage()).toBe(0);
  });

  it('survives a failed write', async () => {
    execute.mockRejectedValueOnce(new Error('db down'));
    recordUserApiUsage(5n, T0);
    await expect(flushUserApiUsage()).resolves.toBe(1);
    expect(__pendingUserApiUsage()).toBe(0);
  });
});
