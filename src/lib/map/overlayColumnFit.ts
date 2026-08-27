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

/** Widest a stored column width may be, in CSS px — past any plausible window. */
export const MAX_OVERLAY_COLUMN_PX = 4000;

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
