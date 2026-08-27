import { describe, expect, it } from 'vitest';
import {
  fitOverlayColumns,
  MIN_OVERLAY_COLUMN_PX,
  type OverlayColumnSizes,
} from '@/lib/map/overlayColumnFit';

const ICON = 20;

const content = (pilot: number, name: number, type: number): OverlayColumnSizes => ({
  pilot,
  name,
  type,
});

const sum = (w: OverlayColumnSizes) => w.pilot + w.name + w.type;

describe('fitOverlayColumns', () => {
  it('gives every column its content width when the fit already fits', () => {
    const result = fitOverlayColumns({
      content: content(100, 80, 120),
      fixed: ICON,
      available: 400,
      policy: 'proportional',
    });
    expect(result.widths).toEqual(content(100, 80, 120));
    expect(result.growBy).toBe(0);
  });

  it('never asks the window to grow under a shrinking policy', () => {
    const result = fitOverlayColumns({
      content: content(100, 100, 100),
      fixed: ICON,
      available: 200,
      policy: 'proportional',
    });
    expect(result.growBy).toBe(0);
    expect(sum(result.widths)).toBeCloseTo(180);
  });

  it('splits the overrun in proportion to each fitted width', () => {
    // 60px overrun over 300px of content: each column gives up a fifth of itself.
    const result = fitOverlayColumns({
      content: content(150, 100, 50),
      fixed: ICON,
      available: 260,
      policy: 'proportional',
    });
    expect(result.widths.pilot).toBeCloseTo(120);
    expect(result.widths.name).toBeCloseTo(80);
    expect(result.widths.type).toBeCloseTo(40);
  });

  it('grows the window by the overrun and keeps every content width', () => {
    const result = fitOverlayColumns({
      content: content(150, 100, 50),
      fixed: ICON,
      available: 260,
      policy: 'grow_window',
    });
    expect(result.widths).toEqual(content(150, 100, 50));
    expect(result.growBy).toBe(60);
  });

  it.each([
    ['eat_pilot', 'pilot'],
    ['eat_name', 'name'],
    ['eat_type', 'type'],
  ] as const)('makes %s take the whole overrun', (policy, column) => {
    const result = fitOverlayColumns({
      content: content(150, 100, 120),
      fixed: ICON,
      available: 350,
      policy,
    });
    const before = content(150, 100, 120);
    expect(result.widths[column]).toBeCloseTo(before[column] - 40);
    for (const other of ['pilot', 'name', 'type'] as const) {
      if (other !== column) expect(result.widths[other]).toBeCloseTo(before[other]);
    }
  });

  it('spreads the residue proportionally when the eaten column hits the floor', () => {
    // 100px overrun, but `name` can only give up 60 before hitting the floor.
    const result = fitOverlayColumns({
      content: content(150, MIN_OVERLAY_COLUMN_PX + 60, 100),
      fixed: ICON,
      available: 258,
      policy: 'eat_name',
    });
    expect(result.widths.name).toBeCloseTo(MIN_OVERLAY_COLUMN_PX);
    expect(result.widths.pilot).toBeLessThan(150);
    expect(result.widths.type).toBeLessThan(100);
    expect(sum(result.widths)).toBeCloseTo(238);
  });

  it('holds every column at the floor when even that cannot fit', () => {
    const result = fitOverlayColumns({
      content: content(150, 100, 120),
      fixed: ICON,
      available: 40,
      policy: 'proportional',
    });
    expect(result.widths).toEqual(
      content(MIN_OVERLAY_COLUMN_PX, MIN_OVERLAY_COLUMN_PX, MIN_OVERLAY_COLUMN_PX),
    );
    expect(result.growBy).toBe(0);
  });
});
