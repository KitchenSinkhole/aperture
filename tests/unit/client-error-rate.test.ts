// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { apertureConfig } from '../../aperture.config';
import { allowClientError, __resetClientErrorRate } from '@/lib/log/clientErrorRate';

// DB-free: the limiter is pure in-memory state, so the per-session + global caps
// and the window roll are fully unit-testable. `now` is injected throughout so
// the fixed window is deterministic.

const PER_SESSION = apertureConfig.CLIENT_ERROR_MAX_PER_SESSION;
const GLOBAL = apertureConfig.CLIENT_ERROR_MAX_GLOBAL;
const WINDOW = apertureConfig.CLIENT_ERROR_RATE_WINDOW_MS;

// Start well past the window so the first call cleanly rolls the fresh state.
const T = 1_000_000;

beforeEach(() => {
  __resetClientErrorRate();
});

describe('allowClientError', () => {
  it('accepts up to the per-session cap, then drops', () => {
    for (let i = 0; i < PER_SESSION; i++) {
      expect(allowClientError('a', T)).toBe(true);
    }
    expect(allowClientError('a', T)).toBe(false);
  });

  it("does not let one session's flood exhaust another (below the global cap)", () => {
    // Flood session 'a' past its cap.
    for (let i = 0; i < PER_SESSION + 5; i++) allowClientError('a', T);
    // 'b' is still under its own cap and the global cap, so it's accepted.
    expect(allowClientError('b', T)).toBe(true);
  });

  it('drops across sessions once the global cap is reached', () => {
    // Fill the global window with distinct sessions, each at its per-session cap.
    const sessions = Math.floor(GLOBAL / PER_SESSION);
    for (let s = 0; s < sessions; s++) {
      for (let i = 0; i < PER_SESSION; i++) {
        expect(allowClientError(`s${s}`, T)).toBe(true);
      }
    }
    // A brand-new session is dropped — the global cap, not its own, is exhausted.
    expect(allowClientError('fresh', T)).toBe(false);
  });

  it('re-allows after the window rolls', () => {
    for (let i = 0; i < PER_SESSION; i++) allowClientError('a', T);
    expect(allowClientError('a', T)).toBe(false);
    // One full window later, both counters reset.
    expect(allowClientError('a', T + WINDOW)).toBe(true);
  });
});
