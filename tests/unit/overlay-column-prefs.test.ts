import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERLAY_COLUMN_FRACTIONS,
  OVERLAY_COLUMN_WIDTHS_KEY,
  readOverlayColumnFractions,
  writeOverlayColumnFractions,
} from '@/lib/map/overlayColumnPrefs';

describe('overlay column fractions', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a stored pair', () => {
    writeOverlayColumnFractions({ pilot: 0.5, name: 0.25 });
    expect(readOverlayColumnFractions()).toEqual({ pilot: 0.5, name: 0.25 });
  });

  it('reads null when nothing is stored', () => {
    expect(readOverlayColumnFractions()).toBeNull();
  });

  it('defaults leave the trailing column a share', () => {
    const { pilot, name } = DEFAULT_OVERLAY_COLUMN_FRACTIONS;
    expect(pilot + name).toBeLessThan(1);
  });

  it.each([
    ['unparseable JSON', 'not json'],
    ['a non-object', '42'],
    ['a missing member', '{"pilot":0.4}'],
    ['a zero share', '{"pilot":0,"name":0.4}'],
    ['a negative share', '{"pilot":-0.2,"name":0.4}'],
    ['a whole-width share', '{"pilot":1,"name":0.4}'],
    ['a non-numeric share', '{"pilot":"0.4","name":0.4}'],
    ['a pair leaving the trailing column nothing', '{"pilot":0.6,"name":0.4}'],
  ])('rejects %s', (_label, raw) => {
    localStorage.setItem(OVERLAY_COLUMN_WIDTHS_KEY, raw);
    expect(readOverlayColumnFractions()).toBeNull();
  });

  it('rejects a pixel-width blob', () => {
    localStorage.setItem(OVERLAY_COLUMN_WIDTHS_KEY, JSON.stringify({ pilot: 92, name: 92 }));
    expect(readOverlayColumnFractions()).toBeNull();
  });

  it.each([
    ['a zero share', { pilot: 0, name: 0.4 }],
    ['a whole-width share', { pilot: 1, name: 0.4 }],
    ['a pair leaving the trailing column nothing', { pilot: 0.7, name: 0.3 }],
  ])('discards %s on write', (_label, fractions) => {
    writeOverlayColumnFractions(fractions);
    expect(localStorage.getItem(OVERLAY_COLUMN_WIDTHS_KEY)).toBeNull();
  });
});
