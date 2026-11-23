import { describe, expect, it } from 'vitest';
import { apertureConfig } from '../../aperture.config';
import {
  connectionExpiredSinceMs,
  connectionExpiresAt,
  connectionTimeLeftMs,
  eolDisplayUrgency,
  eolTimeUrgencyFromMs,
  formatEolTimeLeftTag,
  type ConnectionLifecycleInput,
} from '@/lib/map/connectionState';

const { WORMHOLE_EOL_NOMINAL_MS, WORMHOLE_EOL_CRITICAL_NOMINAL_MS, WORMHOLE_DEFAULT_LIFETIME_MS } =
  apertureConfig;

const CREATED = '2026-05-23T12:00:00.000Z';
const CREATED_MS = new Date(CREATED).getTime();
const EOL = '2026-05-23T18:00:00.000Z';
const EOL_MS = new Date(EOL).getTime();

const wh = (overrides: Partial<ConnectionLifecycleInput> = {}): ConnectionLifecycleInput => ({
  scope: 'wh',
  eolStage: 'none',
  eolAt: null,
  createdAt: CREATED,
  ...overrides,
});

describe('connectionExpiresAt', () => {
  it('returns createdAt + WORMHOLE_DEFAULT_LIFETIME_MS for a non-EOL wormhole', () => {
    const result = connectionExpiresAt(wh());
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(CREATED_MS + WORMHOLE_DEFAULT_LIFETIME_MS);
  });

  it('returns eolAt + WORMHOLE_EOL_NOMINAL_MS for the eol (4h) stage', () => {
    const result = connectionExpiresAt(wh({ eolStage: 'eol', eolAt: EOL }));
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(EOL_MS + WORMHOLE_EOL_NOMINAL_MS);
  });

  it('returns eolAt + WORMHOLE_EOL_CRITICAL_NOMINAL_MS for the critical (1h) stage', () => {
    const result = connectionExpiresAt(wh({ eolStage: 'critical', eolAt: EOL }));
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(EOL_MS + WORMHOLE_EOL_CRITICAL_NOMINAL_MS);
  });

  it('returns null for non-wormhole scopes (stargate / jumpbridge / abyssal never expire)', () => {
    for (const scope of ['stargate', 'jumpbridge', 'abyssal'] as const) {
      expect(connectionExpiresAt(wh({ scope }))).toBeNull();
      expect(connectionExpiresAt(wh({ scope, eolStage: 'eol', eolAt: EOL }))).toBeNull();
    }
  });

  it('returns null when an EOL stage is set but eolAt is missing (stale snapshot defence)', () => {
    expect(connectionExpiresAt(wh({ eolStage: 'eol', eolAt: null }))).toBeNull();
    expect(connectionExpiresAt(wh({ eolStage: 'critical', eolAt: null }))).toBeNull();
  });

  it('returns null for the manual expired stage (no timed expiry to count down to)', () => {
    expect(connectionExpiresAt(wh({ eolStage: 'expired', eolAt: EOL }))).toBeNull();
  });
});

describe('connectionExpiredSinceMs', () => {
  it('returns ms elapsed since eolAt for an expired wormhole', () => {
    const since = connectionExpiredSinceMs(wh({ eolStage: 'expired', eolAt: EOL }), EOL_MS + 90_000);
    expect(since).toBe(90_000);
  });

  it('clamps to zero when the clock is before the flag instant', () => {
    expect(connectionExpiredSinceMs(wh({ eolStage: 'expired', eolAt: EOL }), EOL_MS - 1_000)).toBe(0);
  });

  it('returns null for any non-expired stage or when eolAt is missing', () => {
    expect(connectionExpiredSinceMs(wh({ eolStage: 'none' }), EOL_MS)).toBeNull();
    expect(connectionExpiredSinceMs(wh({ eolStage: 'critical', eolAt: EOL }), EOL_MS)).toBeNull();
    expect(connectionExpiredSinceMs(wh({ eolStage: 'expired', eolAt: null }), EOL_MS)).toBeNull();
  });

  it('returns null for non-wormhole scopes', () => {
    expect(
      connectionExpiredSinceMs(wh({ scope: 'stargate', eolStage: 'expired', eolAt: EOL }), EOL_MS),
    ).toBeNull();
  });
});

describe('connectionTimeLeftMs', () => {
  it('clamps to zero once past expiry instead of going negative', () => {
    const past = CREATED_MS + WORMHOLE_DEFAULT_LIFETIME_MS + 60_000;
    expect(connectionTimeLeftMs(wh(), past)).toBe(0);
  });

  it('returns the remaining ms for a fresh wormhole', () => {
    const remaining = connectionTimeLeftMs(wh(), CREATED_MS + 1_000);
    expect(remaining).toBe(WORMHOLE_DEFAULT_LIFETIME_MS - 1_000);
  });

  it('returns null for non-wormhole scopes', () => {
    expect(connectionTimeLeftMs(wh({ scope: 'stargate' }), CREATED_MS)).toBeNull();
  });

  it('uses the EOL stamp + 4h nominal once the eol stage is flagged', () => {
    const remaining = connectionTimeLeftMs(wh({ eolStage: 'eol', eolAt: EOL }), EOL_MS + 1_000);
    expect(remaining).toBe(WORMHOLE_EOL_NOMINAL_MS - 1_000);
  });

  it('uses the 1h nominal once the critical stage is flagged', () => {
    const remaining = connectionTimeLeftMs(wh({ eolStage: 'critical', eolAt: EOL }), EOL_MS + 1_000);
    expect(remaining).toBe(WORMHOLE_EOL_CRITICAL_NOMINAL_MS - 1_000);
  });
});

describe('eolTimeUrgencyFromMs', () => {
  it('maps countdown to orange then red thresholds', () => {
    expect(eolTimeUrgencyFromMs(2 * 3_600_000)).toBe('warning');
    expect(eolTimeUrgencyFromMs(WORMHOLE_EOL_CRITICAL_NOMINAL_MS)).toBe('critical');
    expect(eolTimeUrgencyFromMs(WORMHOLE_EOL_CRITICAL_NOMINAL_MS + 60_000)).toBe('warning');
    expect(eolTimeUrgencyFromMs(WORMHOLE_EOL_NOMINAL_MS)).toBeNull();
    expect(eolTimeUrgencyFromMs(0)).toBe('critical');
  });
});

describe('eolDisplayUrgency', () => {
  it('treats expired stage and zero countdown as critical', () => {
    expect(eolDisplayUrgency('expired', null)).toBe('critical');
    expect(eolDisplayUrgency('critical', 0)).toBe('critical');
    expect(eolDisplayUrgency('none', 0)).toBeNull();
  });
});

describe('formatEolTimeLeftTag', () => {
  it('formats hours and minutes compactly', () => {
    expect(formatEolTimeLeftTag(3 * 3_600_000 + 42 * 60_000)).toBe('3h 42m');
    expect(formatEolTimeLeftTag(2 * 3_600_000)).toBe('2h');
    expect(formatEolTimeLeftTag(45 * 60_000)).toBe('45m');
  });
});
