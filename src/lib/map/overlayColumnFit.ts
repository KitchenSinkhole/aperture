import type { OverlayFitOverflow } from '@/types';

/**
 * Resolving the system overlay's "fit columns to content" action. Pure geometry,
 * kept out of the component so the overflow policies are unit-testable.
 */

/** The three resizable pilot-table columns, in render order. */
export const OVERLAY_FIT_COLUMNS = ['pilot', 'name', 'type'] as const;

export type OverlayFitColumn = (typeof OVERLAY_FIT_COLUMNS)[number];

export type OverlayColumnSizes = Record<OverlayFitColumn, number>;

/** Narrowest a resizable column may become, in CSS px. */
export const MIN_OVERLAY_COLUMN_PX = 28;

// Sub-pixel residue is not worth another redistribution pass.
const EPSILON = 0.5;

const EATEN_COLUMN: Partial<Record<OverlayFitOverflow, OverlayFitColumn>> = {
  eat_pilot: 'pilot',
  eat_name: 'name',
  eat_type: 'type',
};

export type OverlayFitInput = {
  /** Natural (content) width of each resizable column, in px. */
  content: OverlayColumnSizes;
  /** Combined width of the non-resizable columns (the ship-class icon), in px. */
  fixed: number;
  /** Width the table has to lay out in, in px. */
  available: number;
  policy: OverlayFitOverflow;
};

export type OverlayFitResult = {
  /** The width to apply to each resizable column, in px. */
  widths: OverlayColumnSizes;
  /**
   * Extra width the overlay window needs for `widths` to fit, in px. Non-zero
   * only under `grow_window`; every other policy resolves the overrun by
   * shrinking columns and reports 0.
   */
  growBy: number;
};

/**
 * Take `overrun` px off `sizes`, drawing from each column in proportion to its
 * `weights` entry and never taking a column below `MIN_OVERLAY_COLUMN_PX`. A
 * column that hits the floor drops out and its unclaimed share is re-spread over
 * the rest, so the returned residue is non-zero only when every column is at the
 * floor.
 */
function drawDown(
  sizes: OverlayColumnSizes,
  overrun: number,
  weights: OverlayColumnSizes,
): { sizes: OverlayColumnSizes; residue: number } {
  const out = { ...sizes };
  let remaining = overrun;
  let pool = OVERLAY_FIT_COLUMNS.filter((k) => weights[k] > 0 && out[k] > MIN_OVERLAY_COLUMN_PX);

  while (remaining > EPSILON && pool.length > 0) {
    const totalWeight = pool.reduce((sum, k) => sum + weights[k], 0);
    if (totalWeight <= 0) break;
    let taken = 0;
    for (const k of pool) {
      const share = remaining * (weights[k] / totalWeight);
      const room = out[k] - MIN_OVERLAY_COLUMN_PX;
      const take = Math.min(share, room);
      out[k] -= take;
      taken += take;
    }
    remaining -= taken;
    if (taken <= EPSILON) break;
    pool = pool.filter((k) => out[k] > MIN_OVERLAY_COLUMN_PX);
  }

  return { sizes: out, residue: Math.max(remaining, 0) };
}

/** Order `truncate_cascade` drains columns in: ship name, then pilot name, then type. */
const CASCADE_ORDER: readonly OverlayFitColumn[] = ['name', 'pilot', 'type'];

/**
 * Take `overrun` px off `sizes` one column at a time in `CASCADE_ORDER`, each
 * column absorbing all it can before the next is touched. Overrun past every
 * column's floor is left to overflow.
 */
function cascadeDown(sizes: OverlayColumnSizes, overrun: number): OverlayColumnSizes {
  let out = sizes;
  let remaining = overrun;
  for (const key of CASCADE_ORDER) {
    if (remaining <= EPSILON) break;
    const pass = drawDown(out, remaining, { pilot: 0, name: 0, type: 0, [key]: 1 });
    out = pass.sizes;
    remaining = pass.residue;
  }
  return out;
}

/**
 * Column widths for a fit-to-content, with any overrun past `available` resolved
 * by `policy`. When the content already fits, every column gets its natural
 * width and the last column simply keeps whatever slack is left over.
 *
 * The returned widths always sum to at most `available - fixed`, except when
 * every column has bottomed out at `MIN_OVERLAY_COLUMN_PX` and the table has no
 * choice but to overflow.
 */
export function fitOverlayColumns({
  content,
  fixed,
  available,
  policy,
}: OverlayFitInput): OverlayFitResult {
  const total = fixed + content.pilot + content.name + content.type;
  const overrun = total - available;
  if (overrun <= EPSILON) return { widths: { ...content }, growBy: 0 };

  if (policy === 'grow_window') return { widths: { ...content }, growBy: Math.ceil(overrun) };

  if (policy === 'truncate_cascade') return { widths: cascadeDown(content, overrun), growBy: 0 };

  const eaten = EATEN_COLUMN[policy];
  const weights: OverlayColumnSizes = eaten
    ? { pilot: 0, name: 0, type: 0, [eaten]: 1 }
    : { ...content };

  const first = drawDown(content, overrun, weights);
  // The chosen column bottomed out before absorbing all of it — the rest is
  // spread proportionally rather than left to overflow the window.
  const final = first.residue > EPSILON ? drawDown(first.sizes, first.residue, content) : first;

  return { widths: final.sizes, growBy: 0 };
}

/** Shares of the resizable pool taken by the two leading pilot columns. */
export type OverlayColumnFractions = { pilot: number; name: number };

/** Equal thirds of the resizable pool. */
export const EVEN_OVERLAY_COLUMN_FRACTIONS: OverlayColumnFractions = {
  pilot: 1 / 3,
  name: 1 / 3,
};

/**
 * Pixel widths of the two leading columns for `fractions` laid out in a `pool` px
 * wide (the table width less the non-resizable icon column). No column is left
 * below `MIN_OVERLAY_COLUMN_PX`, including the trailing one that takes whatever
 * these two leave; raising a column to the floor is paid for by the columns that
 * still have room. A pool too narrow for three floor-width columns bottoms every
 * column out and lets the table overflow.
 */
export function fractionsToWidths(
  fractions: OverlayColumnFractions,
  pool: number,
): { pilot: number; name: number } {
  if (!Number.isFinite(pool) || pool < MIN_OVERLAY_COLUMN_PX * 3) {
    return { pilot: MIN_OVERLAY_COLUMN_PX, name: MIN_OVERLAY_COLUMN_PX };
  }

  const typeFraction = Math.max(1 - fractions.pilot - fractions.name, 0);
  const total = fractions.pilot + fractions.name + typeFraction;
  if (total <= 0) {
    return fractionsToWidths(EVEN_OVERLAY_COLUMN_FRACTIONS, pool);
  }

  const scaled: OverlayColumnSizes = {
    pilot: (fractions.pilot / total) * pool,
    name: (fractions.name / total) * pool,
    type: (typeFraction / total) * pool,
  };

  const deficit = OVERLAY_FIT_COLUMNS.reduce(
    (sum, k) => sum + Math.max(MIN_OVERLAY_COLUMN_PX - scaled[k], 0),
    0,
  );
  if (deficit <= EPSILON) {
    return { pilot: Math.round(scaled.pilot), name: Math.round(scaled.name) };
  }

  const raised = { ...scaled };
  for (const k of OVERLAY_FIT_COLUMNS) raised[k] = Math.max(raised[k], MIN_OVERLAY_COLUMN_PX);
  const settled = drawDown(raised, deficit, raised).sizes;
  return { pilot: Math.round(settled.pilot), name: Math.round(settled.name) };
}

/**
 * The inverse of {@link fractionsToWidths}: the shares `widths` represent of a
 * `pool` px pool, with the trailing column credited whatever the two leave (never
 * less than the floor, so the result always leaves it a share).
 */
export function widthsToFractions(
  widths: { pilot: number; name: number },
  pool: number,
): OverlayColumnFractions {
  if (!Number.isFinite(pool) || pool <= 0) return EVEN_OVERLAY_COLUMN_FRACTIONS;
  const type = Math.max(pool - widths.pilot - widths.name, MIN_OVERLAY_COLUMN_PX);
  const total = widths.pilot + widths.name + type;
  return { pilot: widths.pilot / total, name: widths.name / total };
}
