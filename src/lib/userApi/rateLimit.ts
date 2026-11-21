// No `import 'server-only'`: the rest of `src/lib/userApi` is runner-safe, and
// this module is pure in-process state with no server dependency of its own.
import type { UserApiIpGateDecision, UserApiRateDecision } from '@/types';
import { apertureConfig } from '../../../aperture.config';

/**
 * In-process request limits of the `/api/v1/*` user API: the per-IP gate with
 * its failed-auth block (pipeline step 2), the per-token, per-account and
 * global caps (step 6), and the hot-window tracking that turns sustained
 * refusal into a strike.
 *
 * Every counter shares one fixed window aligned to `USER_API_RATE_WINDOW_MS`.
 * When it rolls, every per-key counter map is cleared, which bounds memory
 * regardless of how many keys were seen. Hot-window history and IP blocks
 * outlive a window and are pruned on each roll instead. Nothing is persisted,
 * so no IP ever reaches the database.
 *
 * State is a `globalThis` singleton so it survives HMR.
 */

type IpBlock = { step: number; until: number };

interface RateState {
  windowStart: number;
  global: number;
  perIp: Map<string, number>;
  authFailuresPerIp: Map<string, number>;
  perToken: Map<string, number>;
  perAccount: Map<number, number>;
  rejectsPerToken: Map<string, number>;
  /** Start times of each token's recent hot windows. */
  hotWindows: Map<string, number[]>;
  ipBlocks: Map<string, IpBlock>;
}

declare global {
  var __apertureUserApiRate: RateState | undefined;
}

function freshState(): RateState {
  return {
    windowStart: 0,
    global: 0,
    perIp: new Map(),
    authFailuresPerIp: new Map(),
    perToken: new Map(),
    perAccount: new Map(),
    rejectsPerToken: new Map(),
    hotWindows: new Map(),
    ipBlocks: new Map(),
  };
}

const state: RateState = globalThis.__apertureUserApiRate ?? freshState();
globalThis.__apertureUserApiRate = state;

const blockSteps = apertureConfig.USER_API_IP_BLOCK_STEPS_MS;
/** How long after its block ends an IP's escalation step is remembered. */
const ipBlockMemoryMs = Math.max(...blockSteps);

function roll(now: number): void {
  const windowMs = apertureConfig.USER_API_RATE_WINDOW_MS;
  const start = Math.floor(now / windowMs) * windowMs;
  if (start === state.windowStart) return;
  state.windowStart = start;
  state.global = 0;
  state.perIp.clear();
  state.authFailuresPerIp.clear();
  state.perToken.clear();
  state.perAccount.clear();
  state.rejectsPerToken.clear();
  for (const [key, starts] of state.hotWindows) {
    const kept = recentHotWindows(starts, now);
    if (kept.length === 0) state.hotWindows.delete(key);
    else state.hotWindows.set(key, kept);
  }
  for (const [ip, block] of state.ipBlocks) {
    if (block.until + ipBlockMemoryMs <= now) state.ipBlocks.delete(ip);
  }
}

function recentHotWindows(starts: number[], now: number): number[] {
  return starts.filter((s) => s > now - apertureConfig.USER_API_STRIKE_SPAN_MS);
}

function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}

function resetSec(now: number): number {
  return secondsUntil(state.windowStart + apertureConfig.USER_API_RATE_WINDOW_MS, now);
}

/**
 * Pipeline step 2 for one request from `ip`: refused while the IP serves a
 * failed-auth block, or once it has made `USER_API_MAX_PER_IP` requests this
 * window. An accepted request counts against the IP; a refused one does not.
 */
export function checkUserApiIp(ip: string, now: number = Date.now()): UserApiIpGateDecision {
  roll(now);
  const block = state.ipBlocks.get(ip);
  if (block && block.until > now) return { ok: false, retryAfterSec: secondsUntil(block.until, now) };
  const count = state.perIp.get(ip) ?? 0;
  if (count >= apertureConfig.USER_API_MAX_PER_IP) {
    return { ok: false, retryAfterSec: resetSec(now) };
  }
  state.perIp.set(ip, count + 1);
  return { ok: true };
}

/**
 * Counts one failed auth (any 401) from `ip`. The failure past
 * `USER_API_MAX_AUTH_FAILURES_PER_IP` in one window blocks the IP for the next
 * `USER_API_IP_BLOCK_STEPS_MS` step: the first step, or one step up from the
 * IP's previous block while that is still remembered, capped at the last.
 * Returns true when this failure started a block.
 */
export function recordUserApiAuthFailure(ip: string, now: number = Date.now()): boolean {
  roll(now);
  const failures = (state.authFailuresPerIp.get(ip) ?? 0) + 1;
  if (failures <= apertureConfig.USER_API_MAX_AUTH_FAILURES_PER_IP) {
    state.authFailuresPerIp.set(ip, failures);
    return false;
  }
  state.authFailuresPerIp.delete(ip);
  const previous = state.ipBlocks.get(ip);
  const step = previous ? Math.min(previous.step + 1, blockSteps.length - 1) : 0;
  state.ipBlocks.set(ip, { step, until: now + blockSteps[step]! });
  return true;
}

/**
 * Counts one refusal against a token's current window. The refusal that
 * brings the window to `USER_API_HOT_WINDOW_REJECTS` makes it hot; the hot
 * window that brings the token to `USER_API_STRIKE_HOT_WINDOWS` within
 * `USER_API_STRIKE_SPAN_MS` is a strike, and the history restarts.
 */
function countRejection(key: string, now: number): boolean {
  const rejects = (state.rejectsPerToken.get(key) ?? 0) + 1;
  state.rejectsPerToken.set(key, rejects);
  if (rejects !== apertureConfig.USER_API_HOT_WINDOW_REJECTS) return false;
  const hot = [...recentHotWindows(state.hotWindows.get(key) ?? [], now), state.windowStart];
  if (hot.length >= apertureConfig.USER_API_STRIKE_HOT_WINDOWS) {
    state.hotWindows.delete(key);
    return true;
  }
  state.hotWindows.set(key, hot);
  return false;
}

/**
 * Pipeline step 6 for one request on token `tokenId` owned by account
 * `userId`: the token cap, then the account cap, then the global ceiling. An
 * accepted request counts against all three; a refused one against none.
 * Token- and account-cap refusals count towards the token's hot windows;
 * global-ceiling refusals do not.
 */
export function consumeUserApiRequest(
  tokenId: bigint,
  userId: number,
  now: number = Date.now(),
): UserApiRateDecision {
  roll(now);
  const key = tokenId.toString();
  const limit = apertureConfig.USER_API_MAX_PER_TOKEN;
  const tokenCount = state.perToken.get(key) ?? 0;
  const accountCount = state.perAccount.get(userId) ?? 0;
  const limitedBy =
    tokenCount >= limit
      ? 'token'
      : accountCount >= apertureConfig.USER_API_MAX_PER_ACCOUNT
        ? 'account'
        : state.global >= apertureConfig.USER_API_MAX_GLOBAL
          ? 'global'
          : null;

  const reset = resetSec(now);
  if (limitedBy !== null) {
    return {
      ok: false,
      limitedBy,
      limit,
      remaining: 0,
      resetSec: reset,
      retryAfterSec: reset,
      strike: limitedBy === 'global' ? false : countRejection(key, now),
    };
  }

  state.perToken.set(key, tokenCount + 1);
  state.perAccount.set(userId, accountCount + 1);
  state.global += 1;
  return { ok: true, limit, remaining: limit - tokenCount - 1, resetSec: reset };
}

/**
 * Counts one request sent on a suspended token towards its hot windows.
 * Returns true when it completes a strike.
 */
export function noteUserApiSuspendedRequest(tokenId: bigint, now: number = Date.now()): boolean {
  roll(now);
  return countRejection(tokenId.toString(), now);
}

/** Test seam: clears every counter, hot window and IP block. */
export function __resetUserApiRateLimit(): void {
  Object.assign(state, freshState());
}

/** Test seam: the size of every in-process map, after rolling the window to `now`. */
export function __userApiRateLimitSizes(now: number = Date.now()): Record<string, number> {
  roll(now);
  return {
    perIp: state.perIp.size,
    authFailuresPerIp: state.authFailuresPerIp.size,
    perToken: state.perToken.size,
    perAccount: state.perAccount.size,
    rejectsPerToken: state.rejectsPerToken.size,
    hotWindows: state.hotWindows.size,
    ipBlocks: state.ipBlocks.size,
  };
}
