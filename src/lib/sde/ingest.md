## ingest.ts

**Purpose:** One-shot, re-runnable ingest of the pinned CCP SDE build into every `universe_*` table.
**File:** `src/lib/sde/ingest.ts`

Pinned build: **`SDE_BUILD = 3351823`** (released 2026-05-19), YAML variant. Source: https://developers.eveonline.com/docs/services/static-data. Zip cached at `.sde-cache/sde-<build>-yaml.zip`.

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
| `scripts/data/system-static.csv` | `universe_system_static` | vendored community data (WH statics not in SDE); skipped with a warning if absent |
| `scripts/data/wormhole-overrides.csv` | `universe_type_override` | `Id;Name;scanWormholeStrength`; resolves WH code → typeId, writes attr `3974` with `reason='esi-missing-3974'`. Reseeds authoritatively (delete-by-reason then insert). |
| `scripts/data/wormhole-classes.csv` | `universe_wormhole` | `code;sourceClasses;targetClass` (anoik.is /wormholes); `sourceClasses` is a `|`-joined set; resolves WH code → typeId; empty source cell → null (unspecified); skipped with a warning if absent. Reseeds authoritatively (full delete then insert). |

### Wormhole code → typeId disambiguation
The SDE ships duplicate `Wormhole <CODE>` types under group `988` (e.g. two "Wormhole J244", ids `30667` & `73748` — dogma-identical, both unpublished; ESI returns both and won't pick one). Because the catalog/override CSVs key on the WH code, a naive last-write-wins map can bind routing/overrides to a type id that **no `universe_system_static` row uses** — the static then silently drops from the UI (its `universe_wormhole` join finds nothing). `buildWormholeCodeToTypeId(entries, staticTypeIds)` resolves each collision toward the id present in `system-static.csv` (`readStaticTypeIds()`), and warns only if both colliding ids are referenced by statics.

---

### Vendored community data (anoik.is)

WH data CCP omits from the SDE/ESI is reconstructed by [anoik.is](https://anoik.is). Both files below were derived from anoik.is's single static dataset `https://anoik.is/static/static.json?version=11`, **pulled 2026-05-22**. anoik.is serves this as one cached static asset (the site loads it once into `localStorage`), so the whole dataset is one request — no page scraping. anoik.is is an EVE Online Partner; data is CCP-derived and used here under EVE's third-party developer terms with attribution.

- **`system-static.csv`** (`systemID;typeID`, 3772 rows) — one row per J-space system × static spawn. `systemID` = `solarSystemID`; `typeID` resolved from each system's `statics[]` code via the dataset's per-code `typeID`.
- **`wormhole-classes.csv`** (`code;sourceClasses;targetClass`, 90 rows incl. K162) — the WH-type routing catalog. anoik class labels are mapped to Aperture's vocabulary (`c1`→`C1` … `c6`→`C6`, `c13`→`C13`, `hs`→`H`, `ls`→`L`, `ns`→`0.0`, `thera`→`Thera`), matching `universe_system.security`. `sourceClasses` is the hole's full `src` array `|`-joined (e.g. `S199` → `L|0.0`, `R943` → `H|L|0.0`) — multi-source holes are preserved as a set, **not** collapsed. Empty cells:
  - **Unspecified source** (anoik `src: null` → empty `sourceClasses` → NULL): the universal `K162` reverse-exit, plus the shattered-access holes (`A009` → C13; `C008`/`E004`/`G008`/`L005`/`M001`/`Z006`/`Q003`) whose source is a class 14–18 / shattered system outside Aperture's vocabulary. A null source is treated as "appears anywhere" by the class filter.
  - **Drifter holes** (`B735`/`C414`/`R259`/`S877`/`V928`, dest = barbican/conflux/redoubt/sentinel/vidette = classes 14–18): these are the **k-space-side** signatures that open into a Drifter system, and in-game they spawn only in k-space systems holding a Jove Observatory. Jove-Observatory presence isn't determinable from the ingested SDE (no celestial data), so the source is broadened from anoik's `src: null` to the full k-space set `H|L|0.0` — accurate to "k-space only", which keeps them out of the J-space default-suggestion list. `targetClass` is left empty (Drifter classes C14–C18 aren't in Aperture's vocabulary; revisit if added).
  - anoik's dataset omits the unpublished SDE type `J492` (no statics reference it); the catalog follows anoik and does not carry it.

Re-pull: refetch `static.json`, regenerate (`code;sourceClasses;targetClass`, `|`-joined sources), and re-validate the integrity gate (valid-or-null labels, K162 both-null, `A239` resolves to `C2`/`L`, no non-null-source row left empty after mapping).

---

### SDE_BUILD / SDE_RELEASE_DATE / SDE_ZIP_URL
Pinned-build constants. Bump deliberately and re-validate the Phase-0 gate counts.

### ensureSdeZip(): Promise<string>
Downloads the pinned zip into `.sde-cache/` if not already present; returns its path.

### runIngest(): Promise<IngestResult>
Orchestrates the full ingest in FK-safe order (SDE YAML + vendored CSVs). Upserts via `onConflictDoUpdate` (re-runnable). Returns `{ build, counts }` (row counts per logical table). Bulk inserts chunked at 1000. Invoked by `scripts/sde-bootstrap.ts` (`pnpm sde:bootstrap`). As a final step it calls `computeHubProximity()` (`src/lib/sde/hubProximity.ts`) to recompute each HS system's nearest trade hub onto `universe_system` (`counts.hubProximity`); this runs only in the full ingest (it needs freshly-loaded stargate edges + security), not in `runCsvIngest`.

### runCsvIngest(): Promise<IngestResult>
Re-ingests only the three vendored CSVs (`system-static.csv`, `wormhole-overrides.csv`, `wormhole-classes.csv`) without touching the SDE zip. Derives `systemIds`, `typeIds`, and `wormholeCodeToTypeId` by querying `universe_system` and `universe_type` — requires those tables to be populated first. Invoked by `scripts/csv-ingest.ts` (`pnpm sde:csv`).
