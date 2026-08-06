## ingest.ts

**Purpose:** One-shot, re-runnable ingest of a CCP SDE build into every `universe_*` table.
**File:** `src/lib/sde/ingest.ts`

Bootstrap-floor build: **`SDE_BUILD = 3453885`** (released 2026-07-31), JSONL variant — what a fresh database is seeded with, not a ceiling; `runIngest`'s optional `override` advances a running deployment past it. Source: https://developers.eveonline.com/docs/services/static-data. Zip cached at `.sde-cache/sde-<build>-jsonl.zip`, one file per build currently on disk (`evictSupersededSdeZips` deletes the rest, plus any `.part` file older than the download timeout, after each successful ingest).

### The cached zip is never trusted

A cache entry only ever exists as a complete, verified download, and never survives failing to parse — so a corrupt archive cannot become a permanent, self-perpetuating ingest failure:

- Downloads stream to a process-private `.<pid>.part` file and are `rename`d onto the cache path only after the stream completes, its byte count matches the response's `content-length` (when the CDN declares one), and it clears `MIN_SDE_ZIP_BYTES` (1MB, against a ~100MB archive). An interrupted download, a short body, or a full disk leaves nothing at the cache path, and two concurrent downloaders of the same build cannot interleave bytes.
- The zip `fetch` is capped by `AbortSignal.timeout` at 10 minutes, so a stalled CDN connection fails the ingest instead of hanging its child process.
- `ensureSdeZip` re-downloads a cached file below `MIN_SDE_ZIP_BYTES` rather than returning it.
- Failing to open or decode the archive deletes the cached file. If that file came from the cache rather than the download just made, the build is fetched again and parsed once more before the error stands: a poisoned cache heals inside the run that hits it, and a zip that failed to parse is never left for the next run. `parseSdeArchive` always closes its zip handle before this delete runs, so the handle can never block it.

### Parse-then-write, gated

`runIngest` never writes before the whole build has been validated: `parseSdeArchive` (zip → rows, every JSONL file streamed straight out of the archive and decoded one record at a time through a Zod decoder from `./decoders`, zero DB access) and `parseVendoredCsvs` (the three catalog CSVs, re-bound against the parsed build) both run to completion first; `assertNoExcessiveShrink` then compares the parsed counts against the live tables. Only after all three pass does the write phase (`writeCategories`, `writeTypes`, …) issue a single statement. This makes "a malformed build can't partially overwrite good data" structural — the write functions have no path back to the parse functions.

Two failure modes surface as typed errors:
- **`SdeFormatError`** (`./decoders.ts`) — an SDE JSONL line fails its schema (renamed/dropped key, wrong type), isn't a JSON object, is missing `_key`, or isn't valid JSON at all. Names the file, entry key, and failing field path.
- **`SdeGateError`** (`code: 'binding' | 'shrink' | 'downgrade' | 'concurrent'`) — `binding`: a vendored CSV is missing, or a row's system id / type id / WH code / `targetSystem` name doesn't resolve against the build being ingested. `shrink`: a gated table's new-build count is more than `apertureConfig.SDE_REFRESH_MAX_SHRINK_PCT` below its live count (a table with a live count of 0 is exempt — that's a bootstrap), or a table `syncSdeDeletions` covers has no staged keys for the run. Gated tables are the nine SDE-derived ones; the three CSV-derived tables (`universe_system_static`, `universe_type_override`, `universe_wormhole`) are exempt since their binding check is strictly stronger. `downgrade`: the requested build is older than `ap_sde_state.current_build`. `concurrent`: another ingest already holds the run lock.

### One ingest at a time

`runIngest` runs its whole body under a session-scoped Postgres advisory lock on `hashtextextended('sde-ingest', 0)`, taken with `pg_try_advisory_lock` on a client checked out of the pool for the run's duration and released in a `finally`. `SDE_QUEUE` mutually excludes the `sde-ingest`, `sde-refresh` and `csv-ingest` job tasks, but `pnpm sde:bootstrap` calls `runIngest` in-process without reaching graphile-worker, so the queue alone leaves the CLI free to overlap a job-driven run; the lock closes that. A second run fails immediately with `SdeGateError('concurrent')` rather than queueing — it would only re-ingest the build the holder is already writing. The lock lives on its own connection because a session lock belongs to the connection that took it, and it dies with the session, so a killed or crashed ingest releases it.

The downgrade gate runs inside the lock, since it reads the `ap_sde_state.current_build` a concurrent run would advance, but before the zip is downloaded. The write phase is upsert-only, but deletion sync runs against the older build's staged keys and would remove every row the newer build added, including stargate edges (which have no FK guard); the shrink gate cannot catch it, since a few dozen systems out of ~8k is far under the threshold. This is what keeps `pnpm sde:bootstrap` on a deployment that has self-refreshed past the pin from walking it backwards.

`writeSystemStatics`, `writeTypeOverrides`, and `writeWormholeCatalog` each reseed authoritatively (delete then insert) inside one `db.transaction` — the three tables where an untransacted mid-insert failure would otherwise leave the table empty. The bulk upsert paths for the nine SDE-derived tables stay untransacted; they are idempotent, so a failure mid-run leaves a merged-but-consistent state a re-run repairs. Their removals are handled separately by deletion sync, below.

### Deletion sync

The write phase is upsert-only, so nothing FC removes from the game would otherwise ever leave the database — a removed stargate would sit in `universe_stargate_edge` forever, the mirror image of a real wormhole silently misclassified as a gate. The write phase stages every covered table's key set into `universe_sde_stage` (`stageBuildKeys`, one row per key, under a per-run `runId`) as it writes each table. After the write phase, `runIngest` calls `syncSdeDeletions(runId)`, which deletes rows absent from that staged key set across the nine SDE-derived `universe_*` tables (`DELETION_SPECS`), guarded per-table against every inbound FK — not only `RESTRICT` ones, since a `CASCADE` FK is exactly the case Postgres won't stop and would otherwise silently take rows like `ap_system_stats` or a hand-maintained `universe_wormhole` catalog row with it. A row kept alive by a guard is counted into `SdeDeletionReport.retained`, keyed by table name with a sample of up to 50 ids, and persisted onto `ap_sde_state.retained_orphans`.

`universe_sde_stage` is **UNLOGGED**: a crash between the write phase and the sync empties it, so the next `syncSdeDeletions` call trips the empty-keep gate and aborts loudly rather than a surviving half-populated stage driving a mass delete. Staging opens by sweeping any other `run_id`'s rows — an abandoned attempt, or a `pnpm sde:bootstrap` overlapping a job-driven refresh (the two are not mutually excluded by `SDE_QUEUE`) — so a run only ever reads its own staged keys. `runIngest` clears its own in a `finally`, so a run that fails anywhere past staging does not leave ~1.4M rows sitting in the table until the next ingest sweeps them. Because that sweep is unconditional, `syncSdeDeletions` takes its empty-keep gate and all nine deletes under one `repeatable read` snapshot: an overlapping run's sweep is invisible for the whole sync, so the gate's verdict cannot be falsified by the time the later specs run. Without it a sweep landing mid-loop would leave every remaining spec anti-joining against an empty stage, taking `universe_stargate_edge` and `universe_type_attribute` (the two with no guards) in full. Two runs deleting the same rows surface as a serialization failure that fails the ingest.

`DELETION_SPECS` runs its tables leaf-first — every table appearing in another spec's `guards` is itself processed earlier, which is also why the two composite-key tables (`universe_stargate_edge`, `universe_type_attribute`) sit first despite having no guards of their own: `universe_system`'s guard reads the former and `universe_type`/`universe_dogma_attribute`'s guards read the latter. This makes retention transitive for free: a system kept alive by `ap_map_system` still has a live row when its constellation's guard checks `universe_system.constellation_id`, so the constellation — and in turn its region — is retained too, without extra bookkeeping. Retention is measured as the anti-join survivors immediately *after* each table's delete runs — sound because a later spec can only reach an earlier spec's table through the very `ON DELETE CASCADE` FK its guard already checks. `universe_system.nearest_trade_hub_id` (a column `computeHubProximity` clears and recomputes after this runs) and the FK-less soft references (`ap_structure_event.system_id`, `ap_character.last_system_id`/`.last_ship_type_id`, `universe_incursion.staging_solar_system_id`/`infested_solar_systems`, `universe_killmail.body`) are deliberately excluded from every guard list — they already tolerate ids the SDE snapshot lacks.

Deletion sync runs after `universe_wormhole` and `universe_system_static` have been reseeded (so their rows reflect only the new build when consulted as guards) and before `computeHubProximity`, which BFSes `universe_stargate_edge` and would otherwise bake a removed gate into `nearest_trade_hub_jumps`. `runCsvIngest` does not call it — CSV-only runs never touch the SDE-derived tables it covers.

### SDE file → table mapping (new flat SDE layout)
| SDE entry | Target table | Notes |
|---|---|---|
| `categories.jsonl` | `universe_category` | `name.en`, `published` |
| `groups.jsonl` | `universe_group` | `categoryID`, `name.en` |
| `dogmaAttributes.jsonl` | `universe_dogma_attribute` | `name`/`description` are plain strings; `displayName` localized |
| `types.jsonl` | `universe_type` | 52k rows; builds WH-code→typeId map (group `988`, name `"Wormhole <CODE>"`) |
| `typeDogma.jsonl` | `universe_type_attribute` | `dogmaAttributes[]`; skips type/attr ids absent from their tables (FK safety) |
| `mapRegions.jsonl` | `universe_region` | `name.en`, `description.en` |
| `mapConstellations.jsonl` | `universe_constellation` | `position.{x,y,z}`; `wormholeClassID` retained for system security derivation |
| `mapSolarSystems.jsonl` | `universe_system` | `security` via `deriveSecurityLabel`, overridden to C14–C18 for the five Drifter systems via `drifterClassLabel` (`@/lib/eve/drifterSystems`) since they now share one constellation; `trueSec` = rounded status; `effect` from `SYSTEM_EFFECT_BY_ID` (vendored, not in SDE); a purely-numeric-looking system name (e.g. `6E-578`, id `30003270`) stays a string since JSON quotes it |
| `mapStargates.jsonl` | `universe_stargate_edge` | edge `(solarSystemID → destination.solarSystemID)`, deduped, skips edges whose endpoint system is absent |
| `scripts/data/system-static.csv` | `universe_system_static` | vendored community data (WH statics not in SDE); every row's `systemID`/`typeID` must resolve against the build being ingested (`SdeGateError('binding')` otherwise). Reseeds authoritatively (full delete then insert) inside a transaction — the CSV, not the SDE, is authoritative for this table. |
| `scripts/data/wormhole-overrides.csv` | `universe_type_override` | `Id;Name;scanWormholeStrength`; resolves WH code → typeId (unresolvable code is a hard failure), writes attr `3974` with `reason='esi-missing-3974'`. Reseeds authoritatively (delete-by-reason then insert) inside a transaction. |
| `scripts/data/wormhole-classes.csv` | `universe_wormhole` | `code;sourceClasses;targetClass;targetSystem`; `sourceClasses` is a `|`-joined set; resolves WH code → typeId and a non-empty `targetSystem` name → the parsed build's system id (both hard failures if unresolvable); empty source/target cells → null. Reseeds authoritatively (full delete then insert) inside a transaction. |

A missing CSV file is a hard failure (`SdeGateError('binding')`), not a skip — the CSVs are checked-in source of truth, so absence is an environment fault.

### Wormhole code → typeId disambiguation
The SDE ships duplicate `Wormhole <CODE>` types under group `988` (e.g. two "Wormhole J244", ids `30667` & `73748` — dogma-identical, both unpublished; ESI returns both and won't pick one). Because the catalog/override CSVs key on the WH code, a naive last-write-wins map can bind routing/overrides to a type id that **no `universe_system_static` row uses** — the static then silently drops from the UI (its `universe_wormhole` join finds nothing). `buildWormholeCodeToTypeId(entries, staticTypeIds)` resolves each collision toward the id present in the parsed `system-static.csv` rows, and warns only if both colliding ids are referenced by statics.

Since the WH catalog CSVs are hand-maintained (frozen anoik.is dataset) and self-refresh cannot invent new rows for them, `runIngest` records the gap instead: every group-988 code the ingested build carries with no matching `wormhole-classes.csv` row is collected into `ap_sde_state.uncataloged_wormhole_codes`, so `/setup` can surface "CCP added a hole type nobody has catalogued yet" after a refresh.

Group 988 also carries CCP's unpublished QA test holes (`QA Wormhole A`/`B`, ids `32894`/`32895`), whose trailing token is a bare letter rather than a signature code. Code extraction skips any group-988 type whose name starts with `QA `, in both `parseSdeArchive` and `runCsvIngest`, so they neither enter the code→typeId map nor show up as uncatalogued.

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

### SDE_BUILD / SDE_RELEASE_DATE / SDE_ZIP_URL / SDE_LATEST_MANIFEST_URL
`SDE_BUILD`/`SDE_RELEASE_DATE`/`SDE_ZIP_URL` are the bootstrap-floor build constants (bump deliberately and re-validate the Phase-0 gate counts). `SDE_LATEST_MANIFEST_URL` is the newline-delimited build-freshness manifest `fetchLatestSdeManifest` polls.

### ensureSdeZip(build?: number): Promise<string>
Returns the path to `build`'s zip in `.sde-cache/`, downloading it when absent or below `MIN_SDE_ZIP_BYTES`. Defaults to `SDE_BUILD`. See "The cached zip is never trusted" above for the download and verification rules.

### fetchLatestSdeManifest(): Promise<{ build: number; releaseDate: string }>
Fetches `SDE_LATEST_MANIFEST_URL`, parses each line through `sdeLatestManifestSchema` (`./decoders.ts`), and returns the `_key: "sde"` line's `buildNumber`/`releaseDate` (truncated to `YYYY-MM-DD`). Throws on an HTTP failure or a manifest with no `sde` entry. Called by the `sde-refresh` job task (`src/lib/jobs/tasks/sdeRefresh.ts`).

### parseSdeArchive(zipPath): Promise<ParsedSde>
Parses every SDE JSONL file into rows through the `./decoders` Zod schemas, one record at a time and entirely offline (no DB access). Each entry is streamed straight out of the archive (`node-stream-zip`) — no whole-file document graph, whole-archive buffer, or whole-decompressed-entry buffer is ever resident. Returns the row arrays plus the derived `typeIds`/`attrIds`/`systemIds` sets, `systemNameToId`, and `wormholeCodeEntries`. Throws `SdeFormatError` on the first entry that fails its schema or is missing from the archive. Always closes the zip handle before returning or throwing, so a failed parse never leaves the cached file locked for the caller's cleanup.

### parseVendoredCsvs(bindings): Promise<CsvRows>
Parses the three vendored catalog CSVs and re-binds every row against `bindings` (a `ParsedSde` for `runIngest`, or DB-derived sets for `runCsvIngest`). Throws `SdeGateError('binding')` on a missing file or an unresolvable system id / type id / WH code / `targetSystem` name.

### findShrunkenTables(newCounts, liveCounts, maxPct): ShrunkenTable[]
Pure. Returns the gated tables whose `newCounts` entry is more than `maxPct` below `liveCounts` (a live count of 0 — bootstrap — is skipped).

### syncSdeDeletions(runId: string): Promise<SdeDeletionReport>
Deletes rows absent from `runId`'s staged key set (`universe_sde_stage`) across the nine SDE-derived `universe_*` tables, guarded per-table against every inbound FK. Runs `ANALYZE "universe_sde_stage"` first — freshly staged rows have reset planner stats, and `table_name`'s nine distinct values need real selectivity estimates for the per-table anti-joins to plan well — then opens one `repeatable read` transaction holding both the gate (every `DELETION_SPECS` table must have at least one staged row for `runId`) and all nine deletes, so the whole sync is atomic and reads a single snapshot of the stage table. Returns `{ deleted, retained }`, both keyed by db table name; `retained` entries carry a true count plus a sample of up to 50 ids. Throws `SdeGateError('shrink')` if any covered table has no staged keys for the run. See "Deletion sync" above for the guard and ordering rules.

### runIngest(override?: { build: number; releaseDate: string }): Promise<IngestResult>
Holds the `sde-ingest` advisory lock for its whole body (see "One ingest at a time" above), throwing `SdeGateError('concurrent')` if another ingest already has it. Rejects a build older than `ap_sde_state.current_build` (`SdeGateError('downgrade')`), then parses the whole build (`parseSdeArchive` + `parseVendoredCsvs`) and checks it for excessive shrink (`findShrunkenTables` against the live tables) before writing anything. Only then writes in FK-safe order via `onConflictDoUpdate` (re-runnable) and stages the build's key set (`stageBuildKeys`, under a fresh `randomUUID()` run id) — all inside `parseWriteAndStage`, so the parsed build's row arrays fall out of scope once it returns, before `syncSdeDeletions` runs against the freshly staged build. The run's staged keys are cleared in a `finally`, on the failure path as well as the success one. Returns `{ build, counts }` (row counts per logical table, plus `counts.deleted`, `counts.retainedOrphans`, and `counts.uncatalogedWormholes` — all totals across every table). Bulk inserts chunked at 1000. `override` ingests a build other than the pinned `SDE_BUILD` (the `sde-refresh` job's path); omitted, it ingests `SDE_BUILD`/`SDE_RELEASE_DATE`. Invoked in-process by `scripts/sde-bootstrap.ts` (`pnpm sde:bootstrap`) and `scripts/sde-ingest-child.ts` (the isolated child both the `sde-ingest` and `sde-refresh` job tasks spawn). Near the end it calls `computeHubProximity()` (`src/lib/sde/hubProximity.ts`) to recompute each HS system's nearest trade hub onto `universe_system` (`counts.hubProximity`); this runs only in the full ingest (it needs freshly-loaded, deletion-synced stargate edges + security), not in `runCsvIngest`. On success it upserts the `ap_sde_state` singleton row (`current_build`, `current_release_date`, `refreshed_at`, `retained_orphans`, `uncataloged_wormhole_codes`; clears `behind_since`/`failed_at`/`failure_reason`/`consecutive_failures`) so every deployment records which build it actually holds, then evicts every other cached zip in `.sde-cache/` for the ingested build's superseded siblings.

### recordSdeFailure(reason: string): Promise<void>
Upserts `failed_at` (now), `failure_reason`, and an incremented `consecutive_failures` onto the `ap_sde_state` singleton, creating the row if absent. Shared by the `sde-refresh` and `sde-ingest` job tasks so a failed static-data attempt is visible in `/setup` and not only in `ap_job_run`.

**Parameters:**
- `reason` — the failure message shown to the operator.

---

### runCsvIngest(): Promise<IngestResult>
Re-ingests only the three vendored CSVs without touching the SDE zip, through the same `parseVendoredCsvs` gates as `runIngest`. Derives `systemIds`, `typeIds`, `systemNameToId`, and `wormholeCodeEntries` by querying `universe_system` and `universe_type` — requires those tables to be populated first. Invoked by `scripts/csv-ingest.ts` (`pnpm sde:csv`).
