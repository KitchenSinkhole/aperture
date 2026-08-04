## ingest.ts

**Purpose:** One-shot, re-runnable ingest of the pinned CCP SDE build into every `universe_*` table.
**File:** `src/lib/sde/ingest.ts`

Pinned build: **`SDE_BUILD = 3453885`** (released 2026-07-31), YAML variant. Source: https://developers.eveonline.com/docs/services/static-data. Zip cached at `.sde-cache/sde-<build>-yaml.zip`.

### Parse-then-write, gated

`runIngest` never writes before the whole build has been validated: `parseSdeArchive` (zip → rows, every YAML entry through a Zod decoder from `./decoders`, zero DB access) and `parseVendoredCsvs` (the three catalog CSVs, re-bound against the parsed build) both run to completion first; `assertNoExcessiveShrink` then compares the parsed counts against the live tables. Only after all three pass does `writeParsedSde`'s write phase (`writeCategories`, `writeTypes`, …) issue a single statement. This makes "a malformed build can't partially overwrite good data" structural — the write functions have no path back to the parse functions.

Two failure modes surface as typed errors:
- **`SdeFormatError`** (`./decoders.ts`) — an SDE YAML entry fails its schema (renamed/dropped key, wrong type, list-shaped file). Names the file, entry key, and failing field path.
- **`SdeGateError`** (`code: 'binding' | 'shrink'`) — `binding`: a vendored CSV is missing, or a row's system id / type id / WH code / `targetSystem` name doesn't resolve against the build being ingested. `shrink`: a gated table's new-build count is more than `apertureConfig.SDE_REFRESH_MAX_SHRINK_PCT` below its live count (a table with a live count of 0 is exempt — that's a bootstrap). Gated tables are the nine SDE-derived ones; the three CSV-derived tables (`universe_system_static`, `universe_type_override`, `universe_wormhole`) are exempt since their binding check is strictly stronger.

`writeTypeOverrides` and `writeWormholeCatalog` each reseed authoritatively (delete then insert) inside one `db.transaction` — the two tables where an untransacted mid-insert failure would otherwise leave the table empty. The bulk upsert paths stay untransacted; they are idempotent, so a failure mid-run leaves a merged-but-consistent state a re-run repairs.

### SDE file → table mapping (new flat SDE layout)
| SDE entry | Target table | Notes |
|---|---|---|
| `categories.yaml` | `universe_category` | `name.en`, `published` |
| `groups.yaml` | `universe_group` | `categoryID`, `name.en` |
| `dogmaAttributes.yaml` | `universe_dogma_attribute` | `name`/`description` are plain strings; `displayName` localized |
| `types.yaml` | `universe_type` | 52k rows; builds WH-code→typeId map (group `988`, name `"Wormhole <CODE>"`) |
| `typeDogma.yaml` | `universe_type_attribute` | `dogmaAttributes[]`; skips type/attr ids absent from their tables (FK safety) |
| `mapRegions.yaml` | `universe_region` | `name.en`, `description.en` |
| `mapConstellations.yaml` | `universe_constellation` | `position.{x,y,z}`; `wormholeClassID` retained for system security derivation |
| `mapSolarSystems.yaml` | `universe_system` | `security` via `deriveSecurityLabel`, overridden to C14–C18 for the five Drifter systems via `drifterClassLabel` (`@/lib/eve/drifterSystems`) since they now share one constellation; `trueSec` = rounded status; `effect` from `SYSTEM_EFFECT_BY_ID` (vendored, not in SDE) |
| `mapStargates.yaml` | `universe_stargate_edge` | edge `(solarSystemID → destination.solarSystemID)`, deduped, skips edges whose endpoint system is absent |
| `scripts/data/system-static.csv` | `universe_system_static` | vendored community data (WH statics not in SDE); every row's `systemID`/`typeID` must resolve against the build being ingested (`SdeGateError('binding')` otherwise) |
| `scripts/data/wormhole-overrides.csv` | `universe_type_override` | `Id;Name;scanWormholeStrength`; resolves WH code → typeId (unresolvable code is a hard failure), writes attr `3974` with `reason='esi-missing-3974'`. Reseeds authoritatively (delete-by-reason then insert) inside a transaction. |
| `scripts/data/wormhole-classes.csv` | `universe_wormhole` | `code;sourceClasses;targetClass;targetSystem`; `sourceClasses` is a `|`-joined set; resolves WH code → typeId and a non-empty `targetSystem` name → the parsed build's system id (both hard failures if unresolvable); empty source/target cells → null. Reseeds authoritatively (full delete then insert) inside a transaction. |

A missing CSV file is a hard failure (`SdeGateError('binding')`), not a skip — the CSVs are checked-in source of truth, so absence is an environment fault.

### Wormhole code → typeId disambiguation
The SDE ships duplicate `Wormhole <CODE>` types under group `988` (e.g. two "Wormhole J244", ids `30667` & `73748` — dogma-identical, both unpublished; ESI returns both and won't pick one). Because the catalog/override CSVs key on the WH code, a naive last-write-wins map can bind routing/overrides to a type id that **no `universe_system_static` row uses** — the static then silently drops from the UI (its `universe_wormhole` join finds nothing). `buildWormholeCodeToTypeId(entries, staticTypeIds)` resolves each collision toward the id present in the parsed `system-static.csv` rows, and warns only if both colliding ids are referenced by statics.

---

### Vendored community data (anoik.is)

WH data CCP omits from the SDE/ESI was originally reconstructed from [anoik.is](https://anoik.is), an EVE Online Partner (CCP-derived data, used under EVE's third-party developer terms with attribution). The files below were seeded from anoik.is's single static dataset `https://anoik.is/static/static.json?version=11` (pulled 2026-05-22). anoik.is is frozen and does not carry wormhole types CCP has added since, so these files are **hand-maintained**: new types, and per-type facts anoik never modeled (such as fixed destination systems), are hand-edited directly onto the rows. The CSVs, not anoik.is, are the source of truth.

- **`system-static.csv`** (`systemID;typeID`, 3772 rows) — one row per J-space system × static spawn. `systemID` = `solarSystemID`; `typeID` resolved from each system's `statics[]` code via the dataset's per-code `typeID`.
- **`wormhole-classes.csv`** (`code;sourceClasses;targetClass;targetSystem`, 100 rows incl. K162) — the WH-type routing catalog. anoik class labels are mapped to Aperture's vocabulary (`c1`→`C1` … `c6`→`C6`, `c13`→`C13`, `hs`→`H`, `ls`→`L`, `ns`→`0.0`, `thera`→`Thera`), matching `universe_system.security`. `sourceClasses` is the hole's full `src` array `|`-joined (e.g. `S199` → `L|0.0`, `R943` → `H|L|0.0`) — multi-source holes are preserved as a set, **not** collapsed. `targetSystem` is a system name resolved to `universe_system.id`, set only on fixed-destination holes (`J377` → Turnur, `J492` → Tabbetzur, the five Drifter holes, and the five `C12` holes → Thera). Notable rows:
  - **Unspecified source** (anoik `src: null` → empty `sourceClasses` → NULL): the universal `K162` reverse-exit, plus the shattered-access holes (`A009` → C13; `C008`/`E004`/`G008`/`L005`/`M001`/`Z006`/`Q003`) whose source is a class 14–18 / shattered system outside Aperture's vocabulary. A null source is treated as "appears anywhere" by the class filter.
  - **Drifter holes** (`B735`/`C414`/`R259`/`S877`/`V928` → Barbican/Conflux/Redoubt/Sentinel/Vidette, classes `C15`/`C17`/`C18`/`C14`/`C16`): the **k-space-side** signatures that open into a Drifter system, spawning only in k-space systems holding a Jove Observatory. Jove-Observatory presence isn't determinable from the ingested SDE (no celestial data), so `sourceClasses` is broadened to the full k-space set `H|L|0.0` — accurate to "k-space only", which keeps them out of the J-space default-suggestion list. Each is a fixed-destination hole: `targetSystem` names its Drifter complex and `targetClass` is that complex's class (`C14`–`C18`).
  - **J492** → Tabbetzur: a fixed-destination hole on unpublished SDE type `87827`; no `universe_system_static` references it, so anoik omits it and it is hand-added here.
  - **C12 holes** (`F135`/`F353`/`L031`/`M164`/`T458` → Thera): Thera is the only class-12 system, so any hole leading into `C12` always exits to it. Unlike the other fixed-destination holes these keep their real `sourceClasses` — they are ordinary class-filtered statics that also carry a fixed `targetSystem`.

Editing: hand-edit rows directly (add types, refine sources/targets, set fixed destinations) and keep the integrity gate green (valid-or-null labels, K162 both-null, `A239` resolves to `C2`/`L`, no non-null-source row left empty after mapping). **Do not regenerate from anoik.is.** It is frozen; a regenerate reverts to the stale dataset and drops every hand-added type.

---

### SDE_BUILD / SDE_RELEASE_DATE / SDE_ZIP_URL
Pinned-build constants. Bump deliberately and re-validate the Phase-0 gate counts.

### ensureSdeZip(): Promise<string>
Downloads the pinned zip into `.sde-cache/` if not already present; returns its path.

### parseSdeArchive(zip): ParsedSde
Parses every SDE YAML file into rows through the `./decoders` Zod schemas, entirely offline (no DB access). Returns the row arrays plus the derived `typeIds`/`attrIds`/`systemIds` sets, `systemNameToId`, and `wormholeCodeEntries`. Throws `SdeFormatError` on the first entry that fails its schema.

### parseVendoredCsvs(bindings): Promise<CsvRows>
Parses the three vendored catalog CSVs and re-binds every row against `bindings` (a `ParsedSde` for `runIngest`, or DB-derived sets for `runCsvIngest`). Throws `SdeGateError('binding')` on a missing file or an unresolvable system id / type id / WH code / `targetSystem` name.

### findShrunkenTables(newCounts, liveCounts, maxPct): ShrunkenTable[]
Pure. Returns the gated tables whose `newCounts` entry is more than `maxPct` below `liveCounts` (a live count of 0 — bootstrap — is skipped).

### runIngest(): Promise<IngestResult>
Parses the whole build (`parseSdeArchive` + `parseVendoredCsvs`) and checks it for excessive shrink (`findShrunkenTables` against the live tables) before writing anything. Only then writes in FK-safe order via `onConflictDoUpdate` (re-runnable). Returns `{ build, counts }` (row counts per logical table). Bulk inserts chunked at 1000. Invoked by `scripts/sde-bootstrap.ts` (`pnpm sde:bootstrap`). As a final step it calls `computeHubProximity()` (`src/lib/sde/hubProximity.ts`) to recompute each HS system's nearest trade hub onto `universe_system` (`counts.hubProximity`); this runs only in the full ingest (it needs freshly-loaded stargate edges + security), not in `runCsvIngest`. On success it upserts the `ap_sde_state` singleton row (`current_build`, `current_release_date`, `refreshed_at`; clears `failed_at`/`failure_reason`/`consecutive_failures`) so every deployment records which build it actually holds.

### runCsvIngest(): Promise<IngestResult>
Re-ingests only the three vendored CSVs without touching the SDE zip, through the same `parseVendoredCsvs` gates as `runIngest`. Derives `systemIds`, `typeIds`, `systemNameToId`, and `wormholeCodeEntries` by querying `universe_system` and `universe_type` — requires those tables to be populated first. Invoked by `scripts/csv-ingest.ts` (`pnpm sde:csv`).
