## dscanParser.ts

**Purpose:** Pure, client-safe parser for EVE directional-scan clipboard text.
**File:** `src/lib/map/dscanParser.ts`

---

### parseDscanPaste(text: string): ParsedDscanRow[]
Pure splitter — no DB, no `Date.now()`. The EVE D-Scan emits 4 tab-separated columns in fixed order: `TypeID, Name, Type, Distance`. A row is accepted only when all four columns are present, cell 0 is digits-only, and cells 1 and 2 are non-blank — a language-independent gate that rejects ordinary typed text, so an empty result is a reliable "this paste was not a D-Scan" signal for callers. The full-width requirement matters because a caller that recognizes a paste swallows it: three-column tabular text with a numeric first cell would otherwise cost the user their query. Name and Type are read from fixed positions at the tail — Type is the second-to-last cell, Name everything between the id and it. On a tab-separated row the Name cell is carried **verbatim**, outer spaces included (ESI keeps them in a hull name). Falls back to splitting on 2+ spaces for clipboards that strip tabs; there the Name is trimmed, and a name holding its own run of two or more spaces over-splits yet still yields the right Type, its run rejoined at two spaces. Compare ship names through `shipNameKey`, not `===`. Distance has to be present for the row to count, but its content is never read and is not carried in the output (it reads `-` for objects outside the range readout).

Every row is returned regardless of category — a scan of nothing but structures is still a D-Scan, and collapsing it to an empty result would make the caller mistake it for typed text. Narrowing to ships, out of everything else a scan lists, is the caller's step, against the verdicts `/api/reference/scan-types` returns.

**Parameters:**
- `text` — raw clipboard string.

**Returns:** `ParsedDscanRow[]`.

---

### shipNameKey(name: string): string
The form two ship names are equal on: trimmed, inner whitespace runs collapsed to one space, case folded. ESI keeps a hull name's outer spaces and inner runs while a tab-less paste has lost the outer ones and narrowed the runs, so any comparison between a scanned name and a roster name goes through this on both sides.

---

### Types
- `ParsedDscanRow = { typeId, name, typeName }` — `typeId` is `universe_type.id`, shared by every object of that type in the scan (not a per-object id). `name` is the object's own name, which for a ship is either a custom hull name or the client default `<Pilot>'s <Type>`.

Re-exported from `src/types/index.ts`.
