## SignatureSearchModule

**Purpose:** Map-dashboard panel that searches/filters/sorts every signature on the map and navigates the canvas to a chosen one.
**File:** `src/components/sidebar/SignatureSearchModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| signatures | MapSignature[] | yes | All signatures on the map (searched across systems) |
| systems | MapSystemNode[] | yes | All map systems, joined to signatures for system name/security/tag |
| filters | SigSearchFilters | yes | Current filter state (name, group, activity, max age, security classes); owned by `MapCanvas` |
| onFiltersChange | (f: SigSearchFilters) => void | yes | Commits a filter change back to the owner |
| onNavigate | (systemId: string, sigId: string) => void | yes | Called when a result's "Go" is clicked — selects/centers the system and flashes the row |
| tagScheme | TagScheme | yes | The map's `ap_map.tag_scheme`; picks how the System column combines class and tag |

### Renders
A single frameless `Card` (panel body) with a filter bar (name, group, activity, max-age, class-kind toggles, system-class toggles) above a scrollable, sortable results table (activity glyph, Sig, Group, System, Name, Age, Go) and a result-count line. Empty-state row when no signatures match. Body rows are zebra-striped (even rows tinted) with a hover highlight that takes over on the pointed row.

The activity control is a tri-state Any / Combat / Exploration select. Each result row's leading glyph is the effective site-safety (`combat` → red `Swords`, `exploration` → green `ShieldCheck`, `null` → blank); read-only here (overrides are edited in `SignatureModule`).

### Behaviour & Interactions
- Name input is debounced 150ms before firing `onFiltersChange`; a `filtersRef` (synced via `useLayoutEffect`) keeps the debounce callback from clobbering concurrent non-name filter edits.
- Sort headers (Sig / System / Age) toggle asc/desc; clicking a new field resets to asc.
- The System column's class+tag suffix comes from `classTagLabel`, so it is scheme-dependent: a `0121` map shows the tag alone (its tags are numeric, so `C3` + `2` would be indistinguishable from a class `C32`), every other scheme concatenates. The suffix colour keys on the system's `security` either way.
- System-class toggle buttons multi-select; colored via `systemClassColor`. Each button carries one or more `universe_system.security` labels and is active only when all of them are selected; the `Shattered` button carries C13–C18 (small shattered plus the five Drifter classes) as a single toggle.
- Type toggle buttons (Anomalies / Signatures) filter by `sig.classKind`; a sig with an unknown class (neither) ignores them and always shows.
- Results computed by `buildSigSearchResults` (pure, client-side); `now` ticks every 30s via a `setInterval` effect, so the Age column, age sort, and max-age filter stay live without other interaction. 30s matches the Age label's minute-floor granularity while keeping the `useMemo` from recomputing every render.
- Unlike the former dialog, the panel persists open after navigation — `onNavigate` does not close anything.

### Depends On
- `buildSigSearchResults`, `SigSortField`, `SigSortDir` — `@/lib/map/sigSearch`
- `SIGNATURE_GROUP_CATALOG`, `labelForSignatureGroupKey` — `@/lib/map/signatureGroups`
- `effectiveSignatureActivity` — `@/lib/map/siteActivity` (drives the result-row activity glyph)
- `formatAgoFromMs` — `@/lib/map/relativeTime`
- `systemClassColor` — `@/components/map/styling`
- `classTagLabel` — `@/lib/tagging/display` (scheme-aware System-column class+tag label)

### Local State
- `sortField` / `sortDir` — table sort
- `inputName` — uncommitted name field (debounced into `filters.name`)
- `now` — current time, advanced every 30s by an interval; feeds age display, age sort, and max-age filter
