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
 * Tolerates clipboards that strip tabs by also splitting on 2+ spaces. A name
 * holding its own run of two or more spaces over-splits in that form; the cells
 * between the id and the Type are rejoined, which restores a run of exactly two
 * spaces and narrows a wider one, since the column gaps are padded with spaces
 * too.
 */
export function parseDscanPaste(text: string): ParsedDscanRow[] {
  const out: ParsedDscanRow[] = [];
  if (typeof text !== 'string' || text.length === 0) return out;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.length === 0) continue;

    const tabbed = line.includes('\t');
    const cells = tabbed ? line.split('\t') : line.split(/ {2,}/);
    // A scan line always carries all four columns. Accepting three would let
    // ordinary tabular text with a numeric first cell pass as a D-Scan, and the
    // caller swallows a paste it recognizes — costing the user their query.
    if (cells.length < 4) continue;

    const rawTypeId = (cells[0] ?? '').trim();
    if (!TYPE_ID_RE.test(rawTypeId)) continue;

    // The columns are pinned at both ends: Distance is last, Type the one
    // before it. A tabbed row carries the Name cell verbatim, outer spaces
    // included, since ESI keeps those in a hull name. On the fallback path the
    // padding has already merged with them, and a run of two or more spaces
    // inside the Name over-splits it, so the Name is every cell between the id
    // and the Type rejoined. A hull name never holds such a run, so the tail
    // stays a reliable anchor.
    const name = tabbed ? (cells[1] ?? '') : cells.slice(1, -2).join('  ').trim();
    const typeName = (cells.at(-2) ?? '').trim();
    if (name.trim().length === 0 || typeName.length === 0) continue;

    out.push({ typeId: Number(rawTypeId), name, typeName });
  }

  return out;
}

/**
 * The form two ship names are equal on. ESI keeps a hull name's outer spaces
 * and inner runs; a tab-less paste has lost the outer ones to the column
 * padding and narrowed the runs, so equality is taken on a form that carries
 * neither, case folded.
 */
export function shipNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
