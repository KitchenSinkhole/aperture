/**
 * Signature paste parser — pure, client-safe parser for the EVE in-game
 * probe-scanner clipboard format.
 *
 * Split from `signatureReader.ts` so the parser can be imported from client
 * components (the paste dialog) without dragging in the DB-bound resolver,
 * which is `server-only`.
 *
 * The EVE client emits **6 tab-separated columns** in fixed order:
 * `ID, Class, Group, Name, Signal, Distance` (see
 * `docs/reference/signature-scan-results.md`). The probe scanner never includes
 * a wormhole-type code (`A239` / `K162` / …) in the paste — that's only knowable
 * after warping in. Manual WH-code entry lives in the existing
 * `WormholeTypeSelect` dropdown on each sig row.
 *
 * Distance is validated but not carried in the output. The Class cell is both
 * a gate (rows whose class isn't a recognized signature/anomaly label are
 * dropped) and a persisted value — its resolved `signature`/`anomaly` kind
 * rides along in `ParsedSigRow.classKind`.
 */

import { signatureClassKind, type SignatureClassKind } from './signatureClasses';

export type ParsedSigRow = {
  /** In-game 3-char + 3-digit id, e.g. `ABC-123`. Always uppercased. */
  sigId: string;
  /** Site name cell (`universe_type.name`), `null` when blank in the paste. */
  name: string | null;
  /** Group cell (`universe_group.name`), `null` when blank in the paste. */
  groupName: string | null;
  /** Signal-strength cell as printed (e.g. `100.0%`, `4.2%`), `null` if absent. */
  signal: string | null;
  /** Resolved Class column: `signature` (must scan) or `anomaly` (warpable). */
  classKind: SignatureClassKind;
};

const SIG_ID_RE = /^[A-Z]{3}-\d{3}$/i;

/**
 * Split clipboard text into structured rows. Pure: no DB calls, no `Date.now()`.
 * A row is accepted only when its first cell is a valid sig id (the
 * language-independent `AAA-NNN` gate, which also drops the header row) and its
 * second cell is a recognized localized Class label. The Class check primarily
 * discards other in-game signature classes (ships, deployables, drones, …) that
 * are valid scanner entries but don't belong on a map; it also drops unrelated
 * pasted text.
 *
 * Tolerates clipboards that strip tabs by also splitting on 2+ spaces, but that
 * fallback is best-effort: without tabs, blank Group/Name columns collapse and
 * can't be recovered positionally.
 */
export function parseSignaturePaste(text: string): ParsedSigRow[] {
  const out: ParsedSigRow[] = [];
  if (typeof text !== 'string' || text.length === 0) return out;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.length === 0) continue;

    const cells = line.includes('\t') ? line.split('\t') : line.split(/ {2,}/);
    if (cells.length < 2) continue;

    const sigId = (cells[0] ?? '').trim().toUpperCase();
    if (!SIG_ID_RE.test(sigId)) continue; // header row or garbage

    const classKind = signatureClassKind(cells[1]);
    if (classKind === null) continue; // not a signature/anomaly line

    // Pad to 6 cells so partial rows (no group/name/signal) still parse.
    while (cells.length < 6) cells.push('');

    const groupName = blankToNull(cells[2]);
    const name = blankToNull(cells[3]);
    const signal = blankToNull(cells[4]);

    out.push({ sigId, name, groupName, signal, classKind });
  }

  return out;
}

function blankToNull(cell: string | undefined): string | null {
  const trimmed = (cell ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
}
