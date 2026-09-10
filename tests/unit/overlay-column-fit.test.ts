import { describe, expect, it } from 'vitest';
import {
  EVEN_OVERLAY_COLUMN_FRACTIONS,
  fitOverlayColumns,
  fractionsToWidths,
  MIN_OVERLAY_COLUMN_PX,
  widthsToFractions,
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

describe('fitOverlayColumns — truncate_cascade', () => {
  const cascade = (available: number, sizes: OverlayColumnSizes) =>
    fitOverlayColumns({ content: sizes, fixed: ICON, available, policy: 'truncate_cascade' })
      .widths;

  it('takes the whole overrun off the ship name first', () => {
    const widths = cascade(350, content(150, 100, 120));
    expect(widths.name).toBeCloseTo(60);
    expect(widths.pilot).toBeCloseTo(150);
    expect(widths.type).toBeCloseTo(120);
  });

  it('moves on to the pilot name once the ship name is at the floor', () => {
    // 100px overrun; `name` can only give up 60 before bottoming out.
    const widths = cascade(258, content(150, MIN_OVERLAY_COLUMN_PX + 60, 100));
    expect(widths.name).toBeCloseTo(MIN_OVERLAY_COLUMN_PX);
    expect(widths.pilot).toBeCloseTo(110);
    expect(widths.type).toBeCloseTo(100);
  });

  it('reaches the type column only once both name columns are at the floor', () => {
    const floor = MIN_OVERLAY_COLUMN_PX;
    // 130px overrun; name gives 20, pilot gives 20, type covers the last 90.
    const widths = cascade(
      ICON + floor * 2 + 130,
      content(floor + 20, floor + 20, 220),
    );
    expect(widths.name).toBeCloseTo(floor);
    expect(widths.pilot).toBeCloseTo(floor);
    expect(widths.type).toBeCloseTo(130);
  });

  it('holds every column at the floor when even that cannot fit', () => {
    const widths = cascade(40, content(150, 100, 120));
    expect(widths).toEqual(
      content(MIN_OVERLAY_COLUMN_PX, MIN_OVERLAY_COLUMN_PX, MIN_OVERLAY_COLUMN_PX),
    );
  });
});

describe('fraction <-> width conversion', () => {
  it('splits the pool by the stored shares', () => {
    expect(fractionsToWidths({ pilot: 0.5, name: 0.25 }, 400)).toEqual({ pilot: 200, name: 100 });
  });

  it('holds proportions across a change of pool', () => {
    const fractions = { pilot: 0.5, name: 0.25 };
    const narrow = fractionsToWidths(fractions, 200);
    const wide = fractionsToWidths(fractions, 400);
    expect(wide.pilot / wide.name).toBeCloseTo(narrow.pilot / narrow.name);
    expect(wide.pilot).toBe(narrow.pilot * 2);
  });

  it('gives equal thirds for the even fractions', () => {
    const widths = fractionsToWidths(EVEN_OVERLAY_COLUMN_FRACTIONS, 300);
    expect(widths.pilot).toBe(100);
    expect(widths.name).toBe(100);
  });

  it('never leaves the trailing column below the floor', () => {
    const widths = fractionsToWidths({ pilot: 0.6, name: 0.35 }, 200);
    expect(200 - widths.pilot - widths.name).toBeGreaterThanOrEqual(MIN_OVERLAY_COLUMN_PX);
  });

  it('raises a starved column to the floor out of the columns with room', () => {
    const pool = 300;
    const widths = fractionsToWidths({ pilot: 0.9, name: 0.05 }, pool);
    expect(widths.name).toBeGreaterThanOrEqual(MIN_OVERLAY_COLUMN_PX);
    expect(widths.pilot + widths.name).toBeLessThanOrEqual(pool - MIN_OVERLAY_COLUMN_PX + 1);
  });

  it('bottoms every column out when the pool cannot hold three', () => {
    expect(fractionsToWidths({ pilot: 0.4, name: 0.4 }, 50)).toEqual({
      pilot: MIN_OVERLAY_COLUMN_PX,
      name: MIN_OVERLAY_COLUMN_PX,
    });
  });

  it('round-trips widths back to the fractions that produced them', () => {
    const fractions = { pilot: 0.45, name: 0.3 };
    const widths = fractionsToWidths(fractions, 400);
    const back = widthsToFractions(widths, 400);
    expect(back.pilot).toBeCloseTo(fractions.pilot, 2);
    expect(back.name).toBeCloseTo(fractions.name, 2);
  });

  it('always leaves the trailing column a share', () => {
    const back = widthsToFractions({ pilot: 300, name: 200 }, 400);
    expect(back.pilot + back.name).toBeLessThan(1);
  });

  it('falls back to even thirds for an unmeasured pool', () => {
    expect(widthsToFractions({ pilot: 100, name: 100 }, 0)).toEqual(EVEN_OVERLAY_COLUMN_FRACTIONS);
  });
});
