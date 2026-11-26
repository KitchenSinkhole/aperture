## commandPaletteSystemFocus.ts

**Purpose:** Pure ranking for experimental command-palette and jump-to-system search over on-map systems.
**File:** `src/lib/map/commandPaletteSystemFocus.ts`

---

### matchSystemsForFocus(systems, query): SystemFocusMatch[]
Returns matches for a non-empty query: exact tag first (`exact-tag`), then case-insensitive name / alias / Drifter display-name prefix (`name-prefix`). Empty query returns `[]`.

### focusSystemActionLabel(system): string
Primary label for a `Focus …` command — alias when set, else `systemDisplayName`.
