import { describe, expect, it } from 'vitest';
import {
  isUnscanned,
  resolveIndicator,
  summariseSignatures,
} from '@/lib/map/signatureIndicators';
import type { MapSignature, SignatureIndicatorPrefs } from '@/types';

const NOW = Date.parse('2026-06-04T12:00:00.000Z');
const PREFS: SignatureIndicatorPrefs = {
  thresholdMinutes: 240, // 4h
  showStale: true,
  showUnscanned: true,
};

function sig(overrides: Partial<MapSignature> = {}): MapSignature {
  return {
    id: '1',
    mapSystemId: 'sys-1',
    mapConnectionId: null,
    sigId: 'ABC',
    groupKey: 'data',
    classKind: null,
    typeId: null,
    wormholeCode: null,
    name: 'Some Site',
    description: null,
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    createdAt: new Date(NOW - 3_600_000).toISOString(),
    updatedAt: new Date(NOW - 3_600_000).toISOString(),
    ...overrides,
  };
}

describe('isUnscanned', () => {
  it('flags a sig with no group', () => {
    expect(isUnscanned(sig({ groupKey: null }))).toBe(true);
  });

  it('flags a wormhole missing its type', () => {
    expect(isUnscanned(sig({ groupKey: 'wormhole', typeId: null, mapConnectionId: 'c1' }))).toBe(true);
  });

  it('flags a wormhole missing its leads-to connection', () => {
    expect(isUnscanned(sig({ groupKey: 'wormhole', typeId: 12345, mapConnectionId: null }))).toBe(true);
  });

  it('does not flag a fully-resolved wormhole', () => {
    expect(isUnscanned(sig({ groupKey: 'wormhole', typeId: 12345, mapConnectionId: 'c1' }))).toBe(false);
  });

  it('does not flag a cosmic sig missing only its site name', () => {
    expect(isUnscanned(sig({ groupKey: 'relic', name: null }))).toBe(false);
  });
});

describe('summariseSignatures', () => {
  it('rolls up count, newest updatedAt, and unscanned count per system', () => {
    const map = summariseSignatures([
      sig({ id: '1', mapSystemId: 'a', updatedAt: new Date(NOW - 7_200_000).toISOString() }),
      sig({ id: '2', mapSystemId: 'a', updatedAt: new Date(NOW - 1_000).toISOString(), groupKey: null }),
      sig({ id: '3', mapSystemId: 'b' }),
    ]);
    expect(map.get('a')).toEqual({
      count: 2,
      latestUpdatedAtMs: NOW - 1_000,
      unscannedCount: 1,
    });
    expect(map.get('b')?.count).toBe(1);
    expect(map.has('c')).toBe(false);
  });

  it('ignores unparseable timestamps when picking the newest', () => {
    const map = summariseSignatures([sig({ updatedAt: 'not-a-date' })]);
    expect(map.get('sys-1')?.latestUpdatedAtMs).toBeNull();
  });
});

describe('resolveIndicator', () => {
  it('marks a system stale when its newest sig is past the threshold', () => {
    const summary = { count: 1, latestUpdatedAtMs: NOW - 5 * 3_600_000, unscannedCount: 0 };
    const out = resolveIndicator(summary, true, PREFS, NOW);
    expect(out.stale).toBe(true);
    expect(out.ageMs).toBe(5 * 3_600_000);
  });

  it('does not mark a freshly-scanned system stale', () => {
    const summary = { count: 1, latestUpdatedAtMs: NOW - 60_000, unscannedCount: 0 };
    expect(resolveIndicator(summary, true, PREFS, NOW).stale).toBe(false);
  });

  it('treats an empty wormhole system as stale with no age', () => {
    const out = resolveIndicator(undefined, true, PREFS, NOW);
    expect(out).toEqual({ stale: true, ageMs: null, unscanned: 0 });
  });

  it('shows nothing for empty k-space', () => {
    expect(resolveIndicator(undefined, false, PREFS, NOW)).toEqual({
      stale: false,
      ageMs: null,
      unscanned: 0,
    });
  });

  it('respects the showStale toggle', () => {
    const summary = { count: 1, latestUpdatedAtMs: NOW - 5 * 3_600_000, unscannedCount: 2 };
    const out = resolveIndicator(summary, true, { ...PREFS, showStale: false }, NOW);
    expect(out.stale).toBe(false);
    expect(out.ageMs).toBeNull();
    expect(out.unscanned).toBe(2);
  });

  it('respects the showUnscanned toggle', () => {
    const summary = { count: 1, latestUpdatedAtMs: NOW - 60_000, unscannedCount: 2 };
    expect(resolveIndicator(summary, true, { ...PREFS, showUnscanned: false }, NOW).unscanned).toBe(0);
  });

  it('uses the effective (smaller) threshold', () => {
    const summary = { count: 1, latestUpdatedAtMs: NOW - 3 * 3_600_000, unscannedCount: 0 };
    // 3h old: not stale at 4h, stale at 2h.
    expect(resolveIndicator(summary, true, { ...PREFS, thresholdMinutes: 240 }, NOW).stale).toBe(false);
    expect(resolveIndicator(summary, true, { ...PREFS, thresholdMinutes: 120 }, NOW).stale).toBe(true);
  });
});
