import { apertureConfig } from '../../../aperture.config';

/**
 * In-process, DB-free rate limiter for the `/api/client-errors` ingest route
 * (Phase 7 client error capture). A render loop in one browser must not be able
 * to flood `ap_error_log`, so each report is gated by a per-session cap AND a
 * global cap within a fixed window.
 *
 * State is a `globalThis` singleton (mirror of `bus.ts` / `alerts/rules.ts`) so
 * it survives HMR. No `server-only` import — this is imported by the route but
 * must stay loadable under the bare `vitest`/`tsx` runner for the unit test.
 */

interface Window {
  count: number;
  start: number;
}

interface RateState {
  global: Window;
  perSession: Map<string, Window>;
}

declare global {
  var __apertureClientErrorRate: RateState | undefined;
}

function freshState(): RateState {
  return { global: { count: 0, start: 0 }, perSession: new Map() };
}

const state: RateState = globalThis.__apertureClientErrorRate ?? freshState();
globalThis.__apertureClientErrorRate = state;

/**
 * Whether a client-error report from `sessionKey` is accepted right now.
 *
 * Fixed-window counters: when the global window has elapsed it rolls and the
 * per-session map is cleared (bounding memory regardless of how many distinct
 * sessions reported). Returns `false` — drop the report — once either the
 * per-session cap (`CLIENT_ERROR_MAX_PER_SESSION`) or the global cap
 * (`CLIENT_ERROR_MAX_GLOBAL`) is exceeded for the current window.
 *
 * `now` is injectable for tests.
 */
export function allowClientError(sessionKey: string, now: number = Date.now()): boolean {
  const windowMs = apertureConfig.CLIENT_ERROR_RATE_WINDOW_MS;

  if (now - state.global.start >= windowMs) {
    state.global = { count: 0, start: now };
    state.perSession.clear();
  }

  let session = state.perSession.get(sessionKey);
  if (!session || now - session.start >= windowMs) {
    session = { count: 0, start: now };
    state.perSession.set(sessionKey, session);
  }

  if (
    state.global.count >= apertureConfig.CLIENT_ERROR_MAX_GLOBAL ||
    session.count >= apertureConfig.CLIENT_ERROR_MAX_PER_SESSION
  ) {
    return false;
  }

  state.global.count += 1;
  session.count += 1;
  return true;
}

/** Test seam: clear all rate-limit state between cases. */
export function __resetClientErrorRate(): void {
  state.global = { count: 0, start: 0 };
  state.perSession.clear();
}
