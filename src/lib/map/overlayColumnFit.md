## overlayColumnFit.ts

**Purpose:** Pure geometry behind the system overlay's resizable pilot columns — the fit-to-content pass under the instance's `OverlayFitOverflow` policy, and the conversion between stored proportions and applied pixel widths.
**File:** `src/lib/map/overlayColumnFit.ts`

---

### OVERLAY_FIT_COLUMNS
`readonly ['pilot', 'name', 'type']` — the resizable pilot-table columns, in render order. `OverlayFitColumn` is the union of its members; `OverlayColumnSizes` is `Record<OverlayFitColumn, number>` (px).

### MIN_OVERLAY_COLUMN_PX
`28` — the floor a resizable column is never taken below, by a drag, a fit, or a change of window size.

### OverlayColumnFractions
`{ pilot: number; name: number }` — shares of the resizable pool (the table width less the fixed icon column). The `type` column's share is `1 - pilot - name`.

### EVEN_OVERLAY_COLUMN_FRACTIONS
`{ pilot: 1/3, name: 1/3 }` — equal thirds of the pool.

---

### fitOverlayColumns(input: OverlayFitInput): OverlayFitResult
Column widths for a fit-to-content pass.

**Parameters:**
- `input.content` — natural (content) width of each resizable column, px
- `input.fixed` — combined width of the non-resizable columns (the ship-class icon), px
- `input.available` — the width the table has to lay out in, px
- `input.policy` — the instance's `OverlayFitOverflow` value

**Returns:** `{ widths, growBy }`. `widths` is the width to apply per resizable column; `growBy` is the extra window width needed, non-zero only under `grow_window`.

When the content fits, every column gets its natural width. Otherwise the overrun is drawn down: `proportional` weights each column by its own fitted width, `eat_pilot` / `eat_name` / `eat_type` put the whole draw on one column, `truncate_cascade` drains `name` to its floor, then `pilot`, then `type`, and `grow_window` shrinks nothing. No column goes below `MIN_OVERLAY_COLUMN_PX` — a column that bottoms out drops out of the draw and its unclaimed share is re-spread over the rest, so an `eat_*` column too small to absorb the overrun leaves the remainder to a proportional pass. The returned widths sum to at most `available - fixed` unless every column has bottomed out.

---

### fractionsToWidths(fractions: OverlayColumnFractions, pool: number): { pilot: number; name: number }
Pixel widths of the two leading columns for `fractions` laid out in a `pool` px pool.

**Returns:** rounded px widths. No column — including the trailing one, which takes whatever these two leave — is left below `MIN_OVERLAY_COLUMN_PX`; raising a starved column to the floor is paid for by the columns that still have room. A pool too narrow for three floor-width columns bottoms every column out and lets the table overflow.

### widthsToFractions(widths: { pilot: number; name: number }, pool: number): OverlayColumnFractions
The inverse of `fractionsToWidths`. The trailing column is credited whatever the two leave, never less than the floor, so the result always leaves it a share. An unmeasured (non-positive) pool yields `EVEN_OVERLAY_COLUMN_FRACTIONS`.
