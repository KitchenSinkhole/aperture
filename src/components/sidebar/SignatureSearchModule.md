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

### Renders
A single frameless `Card` (panel body) with a filter bar (name, group, activity, max-age, class-kind toggles, system-class toggles) above a scrollable, sortable results table (activity glyph, Sig, Group, System, Name, Age, Go) and a result-count line. Empty-state row when no signatures match. Body rows are zebra-striped (even rows tinted) with a hover highlight that takes over on the pointed row.

The activity control is a tri-state Any / Combat / Exploration select. Each result row's leading glyph is the effective site-safety (`combat` → red `Swords`, `exploration` → green `ShieldCheck`, `null` → blank); read-only here (overrides are edited in `SignatureModule`).

### Behaviour & Interactions
- Name input is debounced 150ms before firing `onFiltersChange`; a `filtersRef` (synced via `useLayoutEffect`) keeps the debounce callback from clobbering concurrent non-name filter edits.
- Sort headers (Sig / System / Age) toggle asc/desc; clicking a new field resets to asc.
- System-class toggle buttons multi-select; colored via `systemClassColor`.
- Type toggle buttons (Anomalies / Signatures) filter by `sig.classKind`; a sig with an unknown class (neither) ignores them and always shows.
- Results computed by `buildSigSearchResults` (pure, client-side); `now` ticks every 30s via a `setInterval` effect, so the Age column, age sort, and max-age filter stay live without other interaction. 30s matches the Age label's minute-floor granularity while keeping the `useMemo` from recomputing every render.
- Unlike the former dialog, the panel persists open after navigation — `onNavigate` does not close anything.

### Depends On
- `buildSigSearchResults`, `SigSortField`, `SigSortDir` — `@/lib/map/sigSearch`
- `SIGNATURE_GROUP_CATALOG`, `labelForSignatureGroupKey` — `@/lib/map/signatureGroups`
- `effectiveSignatureActivity` — `@/lib/map/siteActivity` (drives the result-row activity glyph)
- `formatAgoFromMs` — `@/lib/map/relativeTime`
- `systemClassColor` — `@/components/map/styling`

### Local State
- `sortField` / `sortDir` — table sort
- `inputName` — uncommitted name field (debounced into `filters.name`)
- `now` — current time, advanced every 30s by an interval; feeds age display, age sort, and max-age filter
