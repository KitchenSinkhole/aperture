// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apertureConfig } from '../../aperture.config';
import {
  allowPublicUpgrade,
  closePublicSocketsForToken,
  publicSocketCount,
  publicSocketTotal,
  registerPublicSocket,
  __resetPublicSockets,
} from '@/lib/realtime/publicSockets';

// DB-free: admission and the socket registry are pure in-memory state, and
// `now` is injected throughout so the fixed rate window is deterministic.

const WINDOW = apertureConfig.PUBLIC_WS_UPGRADE_WINDOW_MS;
const PER_IP = apertureConfig.PUBLIC_WS_MAX_UPGRADES_PER_IP;
const GLOBAL = apertureConfig.PUBLIC_WS_MAX_UPGRADES_GLOBAL;
const MAX_PER_TOKEN = apertureConfig.PUBLIC_WS_MAX_PER_TOKEN;

// Start well past the window so the first call cleanly rolls the fresh state.
const T = 1_000_000;

beforeEach(() => {
  __resetPublicSockets();
});

describe('allowPublicUpgrade', () => {
  it('accepts up to the per-IP cap, then drops', () => {
    for (let i = 0; i < PER_IP; i++) expect(allowPublicUpgrade('1.1.1.1', T)).toBe(true);
    expect(allowPublicUpgrade('1.1.1.1', T)).toBe(false);
  });

  it("does not let one address's flood exhaust another (below the global cap)", () => {
    for (let i = 0; i < PER_IP + 5; i++) allowPublicUpgrade('1.1.1.1', T);
    expect(allowPublicUpgrade('2.2.2.2', T)).toBe(true);
  });

  it('drops across addresses once the global cap is reached', () => {
    const addresses = Math.floor(GLOBAL / PER_IP);
    for (let a = 0; a < addresses; a++) {
      for (let i = 0; i < PER_IP; i++) expect(allowPublicUpgrade(`a${a}`, T)).toBe(true);
    }
    expect(allowPublicUpgrade('fresh', T)).toBe(false);
  });

  it('re-allows after the window rolls, clearing the per-IP map', () => {
    for (let i = 0; i < PER_IP; i++) allowPublicUpgrade('1.1.1.1', T);
    expect(allowPublicUpgrade('1.1.1.1', T)).toBe(false);
    expect(allowPublicUpgrade('1.1.1.1', T + WINDOW)).toBe(true);
  });
});

describe('registerPublicSocket / publicSocketCount / publicSocketTotal', () => {
  it('counts sockets per token and in total', () => {
    const offA1 = registerPublicSocket('tok-a', vi.fn());
    registerPublicSocket('tok-a', vi.fn());
    registerPublicSocket('tok-b', vi.fn());

    expect(publicSocketCount('tok-a')).toBe(2);
    expect(publicSocketCount('tok-b')).toBe(1);
    expect(publicSocketTotal()).toBe(3);

    offA1();
    expect(publicSocketCount('tok-a')).toBe(1);
    expect(publicSocketTotal()).toBe(2);
  });

  it('forgets a token once its last socket deregisters', () => {
    const off = registerPublicSocket('tok-a', vi.fn());
    off();
    expect(publicSocketCount('tok-a')).toBe(0);
    expect(publicSocketTotal()).toBe(0);
  });

  it('rejects a token once it hits the per-token cap (enforced by the caller)', () => {
    for (let i = 0; i < MAX_PER_TOKEN; i++) registerPublicSocket('tok-full', vi.fn());
    expect(publicSocketCount('tok-full')).toBe(MAX_PER_TOKEN);
    // The cap itself is enforced by the WS upgrade handler reading this count
    // before registering one more — this module just reports it accurately.
  });
});

describe('closePublicSocketsForToken', () => {
  it('closes every socket registered for the token, and only that token', () => {
    const closeA1 = vi.fn();
    const closeA2 = vi.fn();
    const closeB = vi.fn();
    registerPublicSocket('tok-a', closeA1);
    registerPublicSocket('tok-a', closeA2);
    registerPublicSocket('tok-b', closeB);

    const closed = closePublicSocketsForToken('tok-a');

    expect(closed).toBe(2);
    expect(closeA1).toHaveBeenCalledWith(4001);
    expect(closeA2).toHaveBeenCalledWith(4001);
    expect(closeB).not.toHaveBeenCalled();
  });

  it('is safe when the closer itself deregisters synchronously', () => {
    // Mirrors the real wsServer usage: `close` triggers the socket's own
    // 'close' handler, which calls the deregister fn returned by
    // `registerPublicSocket`, mutating the same set mid-iteration.
    const off: { one?: () => void; two?: () => void } = {};
    const close1 = vi.fn(() => off.one?.());
    const close2 = vi.fn(() => off.two?.());
    off.one = registerPublicSocket('tok-a', close1);
    off.two = registerPublicSocket('tok-a', close2);

    expect(closePublicSocketsForToken('tok-a')).toBe(2);
    expect(publicSocketCount('tok-a')).toBe(0);
  });

  it('returns 0 for a token with no live sockets', () => {
    expect(closePublicSocketsForToken('nobody-home')).toBe(0);
  });
});
