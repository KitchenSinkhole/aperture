## overlayColumnFit.ts

**Purpose:** Pure geometry behind the system overlay's "fit columns to content" action — turns measured content widths into applied column widths under the instance's `OverlayFitOverflow` policy.
**File:** `src/lib/map/overlayColumnFit.ts`

---

### OVERLAY_FIT_COLUMNS
`readonly ['pilot', 'name', 'type']` — the resizable pilot-table columns, in render order. `OverlayFitColumn` is the union of its members; `OverlayColumnSizes` is `Record<OverlayFitColumn, number>` (px).

### MIN_OVERLAY_COLUMN_PX
`28` — the floor a resizable column is never taken below, by a drag or by a fit.

### MAX_OVERLAY_COLUMN_PX
`4000` — the ceiling a stored column width is validated against.

---

### fitOverlayColumns(input: OverlayFitInput): OverlayFitResult
Column widths for a fit-to-content pass.

**Parameters:**
- `input.content` — natural (content) width of each resizable column, px
- `input.fixed` — combined width of the non-resizable columns (the ship-class icon), px
- `input.available` — the width the table has to lay out in, px
- `input.policy` — the instance's `OverlayFitOverflow` value

**Returns:** `{ widths, growBy }`. `widths` is the width to apply per resizable column; `growBy` is the extra window width needed, non-zero only under `grow_window`.

When the content fits, every column gets its natural width. Otherwise the overrun is drawn down: `proportional` weights each column by its own fitted width, `eat_pilot` / `eat_name` / `eat_type` put the whole draw on one column, and `grow_window` shrinks nothing. No column goes below `MIN_OVERLAY_COLUMN_PX` — a column that bottoms out drops out of the draw and its unclaimed share is re-spread over the rest, so an `eat_*` column too small to absorb the overrun leaves the remainder to a proportional pass. The returned widths sum to at most `available - fixed` unless every column has bottomed out.
