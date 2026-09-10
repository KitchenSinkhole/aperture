/**
 * Directional-scan paste parser — pure, client-safe parser for the EVE in-game
 * D-Scan clipboard format.
 *
 * The EVE client emits **4 tab-separated columns** in fixed order:
 * `TypeID, Name, Type, Distance`, e.g.
 *
 * ```
 * 33697	❤ DAILY-(c)	Prospect	13 km
 * ```
 *
 * Column 0 is the `universe_type.id`, not a per-object id — every Athanor in a
 * scan reports the same `35835`. It is the only language-independent handle on
 * what a row *is*, so it carries the ship/non-ship distinction. Rows are parsed
 * regardless of category and narrowed by the caller, since an all-structures
 * scan is still a D-Scan.
 *
 * The Name cell is the object's own name — for a ship that is either the
 * pilot's custom hull name or the client default `<Pilot>'s <Type>`. Distance
 * has to be present for the row to count, but its content is never read and it
 * is not carried in the output; it reads `-` for objects outside the scan's
 * range readout.
 */

export type ParsedDscanRow = {
  /** `universe_type.id` of the scanned object (cell 0), shared by every object of that type. */
  typeId: number;
  /** Name cell: a custom hull name, or the client default `<Pilot>'s <Type>`. */
  name: string;
  /** Type cell (`universe_type.name`), e.g. `Prospect`. */
  typeName: string;
};

const TYPE_ID_RE = /^\d+$/;

/**
 * Split clipboard text into structured rows. Pure: no DB calls, no `Date.now()`.
 * A row is accepted only when cell 0 is all digits and cells 1 and 2 are both
 * non-blank — a language-independent gate that rejects ordinary typed text, so
 * a caller can use an empty result to mean "this paste was not a D-Scan".
 *
 * Tolerates clipboards that strip tabs by also splitting on 2+ spaces; the
 * columns are space-padded in that form, so only a name containing a run of
 * two or more spaces is mis-split.
 */
export function parseDscanPaste(text: string): ParsedDscanRow[] {
  const out: ParsedDscanRow[] = [];
  if (typeof text !== 'string' || text.length === 0) return out;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.length === 0) continue;

    const cells = line.includes('\t') ? line.split('\t') : line.split(/ {2,}/);
    // A scan line always carries all four columns. Accepting three would let
    // ordinary tabular text with a numeric first cell pass as a D-Scan, and the
    // caller swallows a paste it recognizes — costing the user their query. More
    // than four is still fine: a name holding a run of spaces over-splits.
    if (cells.length < 4) continue;

    const rawTypeId = (cells[0] ?? '').trim();
    if (!TYPE_ID_RE.test(rawTypeId)) continue;

    const name = (cells[1] ?? '').trim();
    const typeName = (cells[2] ?? '').trim();
    if (name.length === 0 || typeName.length === 0) continue;

    out.push({ typeId: Number(rawTypeId), name, typeName });
  }

  return out;
}
