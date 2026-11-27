# SDE API Migration

**Goal:** Aperture ingests static data from FC's SDE API (`https://sde.evetech.net`) instead of the zip download, and applies a typical release as a small record-level delta instead of a full re-ingest.
**References:** `src/lib/sde/ingest.md`, `src/lib/sde/decoders.md`, `src/lib/jobs/tasks/sdeRefresh.md`, `src/lib/jobs/tasks/sdeIngest.md`, `src/db/schema/ap/sde_state.md`, CLAUDE.md (database rules, config rules, code style: no backwards-compatibility shims).

**Background:** FC announced the SDE API on 2026-11-19 (https://developers.eveonline.com/blog/the-sde-over-http-static-data-dynamically). The zip files "stay available for now" with no retirement date, and FC recommends moving. Today every new build means a ~100MB zip download and a full ingest (bulk upserts of every table, ~1.4M staged keys, deletion sync, hub proximity). The API serves tables individually, publishes a per-table `version`, lists the changed keys of every release, and serves single records.

**Verified against the live API on 2026-11-27** (stage sessions should not need to re-probe these):

- `GET /tranquility/` lists releases. Only **two** are retained. An older release URL returns 404.
- `GET /tranquility/latest/` 302s to `/tranquility/<release>/` (the redirect is cached for 5 minutes). The release index is one JSON object: `{ release, buildNumber, releaseDate, tables }`. `tables` is an **object keyed by table name** (104 entries), each `{ version, jsonl: { url, recordSchemaUrl }, flatbuffers: {…}, record: { urlTemplate, schemaUrl, exampleUrl } }`.
- `release` is a fixed-width `YYYYMMDDTHHMMSSZ` string, so plain string comparison orders releases chronologically. `buildNumber` matches the zip manifest's build for the same day and is not unique per release.
- A table's `jsonl.url` 302s to `/blobs/<version>.jsonl`, served `Content-Encoding: gzip` (even when the client asks for `identity`), `Transfer-Encoding: chunked` (no `Content-Length`), `Cache-Control: immutable`, `ETag: "<version>"`. Node's `fetch` follows the redirect and decompresses on its own.
- `version` is opaque. It is not the SHA-256 of the decompressed JSONL nor of the gzip body, so there is no checksum to verify a download against.
- A single record is at `record.urlTemplate` with `{key}` substituted (e.g. `…/mapSolarSystems/30003270.json`) and has the same shape as that record's JSONL line.
- Records carry a named key field first and no `_key`:

  | Table | Key field | Records | Gzip / raw |
  |---|---|---|---|
  | `categories` | `categoryID` | 48 | 4KB / 10KB |
  | `groups` | `groupID` | 1,633 | 146KB / 773KB |
  | `dogmaAttributes` | `attributeID` | 2,929 | 241KB / 1.3MB |
  | `types` | `typeID` | 53,959 | 25MB / 153MB |
  | `typeDogma` | `typeID` | 27,296 | 1.3MB / 24MB |
  | `mapRegions` | `regionID` | 114 | 188KB / 438KB |
  | `mapConstellations` | `constellationID` | 1,184 | 114KB / 451KB |
  | `mapSolarSystems` | `solarSystemID` | 8,490 | 1.1MB / 4.8MB |
  | `mapStargates` | `stargateID` | 13,982 | 495KB / 2.7MB |
  | `mapSecondarySuns` | `sunID` | 1,038 | 43KB / n/a |

- Every non-key field the current decoders read is still present under the same name and type (`groupID`, `categoryID`, `name` as a locale object, `dogmaAttributes[].attributeID/value`, `regionID`, `constellationID`, `wormholeClassID`, `securityStatus`, `securityClass`, `position.{x,y,z}`, `destination.solarSystemID`).
- `_changes` (one record per release): `{ comparedWith: "tranquility@<previous release>", tables: [{ table, added?, removed?, changed?, changedLocalization?, fileAdded?, fileRemoved?, fileRenamed?, schemaChanged? }] }`. Each key list is `{ ints: number[], strings: string[] }`. A table that did not change is absent.
- `_schemaChangelog` (22 records): `{ afterBuildNumber, date, tables: [{ table, change?, fields: [{ field, change?, renamedFrom? }] }] }`. Entries describe changes already in effect, not upcoming ones.
- `mapSolarSystems` carries a system-level `wormholeClassID` on 692 systems: `8` on 687 low-sec k-space systems and `14`–`18` on exactly the five Drifter systems (`31000001`→14, `31000002`→15, `31000003`→16, `31000004`→17, `31000006`→18).
- `mapSecondarySuns` has one row per effect system: `{ sunID, solarSystemID, typeID, effectBeaconTypeID, position }`. `typeID` is the visible sun (six types); **`effectBeaconTypeID` is what the game applies** (issue #225, confirmed in game and with FC). The two agree on 1,036 systems and differ on two, and the vendored `SYSTEM_EFFECT_BY_ID` (like anoik.is and zKillboard) follows the sun and is therefore wrong on both: J005926 (`31002508`) is shown as Pulsar but has a Red Giant beacon (`30848`); J010569 (`31002509`) is shown as Red Giant but has a Wolf-Rayet beacon (`30849`).
- The 36 beacon types (group `920`, named "Class N <Effect> Effects") by effect: Pulsar `30844`, `30865`–`30869`; Black Hole `30845`, `30850`–`30854`; Cataclysmic Variable `30846`, `30880`–`30884`; Magnetar `30847`, `30860`–`30864`; Red Giant `30848`, `30870`–`30874`; Wolf-Rayet `30849`, `30875`–`30879`.
- Still absent from the SDE: scan strength (attribute `3974`) on all 132 group-988 types, and wormhole statics. Both vendored CSVs stay.

**Measured from FC's per-build change files** (`https://developers.eveonline.com/static-data/tranquility/changes/<build>.jsonl`, 150 builds, 2025-10-10 to 2026-11-27):

- Recent cadence is about one build every 2.2 days (30 builds in 66 days).
- `types` changed in 26 of the last 30 builds, and at least one of our tables in 28 of 30. Skipping releases that leave our tables untouched therefore avoids very few ingests.
- The changes are small: a median of 5 added or changed keys per build across our tables, 23 of 28 builds at 50 keys or fewer, a maximum of 1,792.
- Map tables change rarely: `mapStargates` in 5 builds over 13 months, any map table in 21 of 134. Removals from our tables happened in 5 builds over 13 months (8 keys in total).
- Under the delta rules below, 23 of the last 28 builds that needed an ingest (104 of 134 over 13 months) would have been applied as a delta. The rest fall back to a full ingest: 21 for a map-table change, 4 for a schema flag, 3 over the record cap, 2 for a removal.

**Key design decisions (agreed up front):**

- **The pinned bootstrap build goes away.** With two releases retained, a pinned release is unfetchable within days. Every ingest targets the latest published release. `SDE_BUILD`, `SDE_RELEASE_DATE` and `SDE_ZIP_URL` are deleted. Format drift is already defended by the Zod decoders and the parse-then-write gates, which is what the pin originally stood in for.
- **Release identity is the `release` string, not the build number.** `ap_sde_state` gains `current_release` and `latest_release` (text). "Behind" and the downgrade gate compare releases. `current_build` / `latest_build` / the release-date columns stay as display values.
- **A release that leaves our tables untouched is not an ingest.** `ap_sde_state.table_versions` (`jsonb`, table name to `version`) records the versions the database matches. When a newer release carries the same versions, `sde-refresh` advances `current_release` without spawning anything. `current_release` therefore means "the newest release this database is known to match".
- **The full ingest stays the reference path, and a delta is an optimisation that may only ever fall back to it.** The delta path covers the five item tables (`categories`, `groups`, `dogmaAttributes`, `types`, `typeDogma`) and upserts only; anything it cannot prove safe goes through the full ingest unchanged. Stage 6 lists the rules.
- **A full ingest is forced periodically.** `ap_sde_state.full_ingest_at` records the last one; a delta is refused once it is older than `SDE_FULL_INGEST_MAX_AGE_DAYS`, so an incomplete `_changes` from FC cannot let the database drift indefinitely.
- **No disk cache.** Tables stream from HTTP straight into the decoder. `.sde-cache/`, the `.part` protocol, eviction, the cache-poisoning retry and the compose volume are deleted. A transport failure fails the run before any write, and the task's `maxAttempts: 2` plus the next daily tick are the retry.
- **A full ingest reads all its tables from one release index**, resolved once per run, so the files always belong together.
- **`sde-ingest` (the `/setup` repair card) runs a full ingest of the latest release unconditionally.** "Re-run the build this database holds" cannot survive two-release retention. `sde-refresh` stays the conditional path and is the only caller that may take a delta.
- **No zip fallback.** Per the no-shims rule the zip path is removed in the same stage that replaces it. Reverting the commit is the rollback while FC still publishes zips.
- **Wormhole effects and Drifter classes come from the SDE.** `mapSecondarySuns` becomes the tenth ingested table and replaces the vendored `SYSTEM_EFFECT_BY_ID`; the system-level `wormholeClassID` replaces the Drifter class pin. The effect is derived from `effectBeaconTypeID`, not the sun `typeID`, which fixes issue #225 for the two systems where they differ.
- **FC's schema changelog is captured for operators, not acted on.** The decoders remain the only gate; the changelog is context shown in `/setup` next to a failure.
- **SDE API requests send the deployment's `EVE_USER_AGENT`**, the same header the ESI client sends.

**Non-goals:** FlatBuffers; delta application for map tables or removals; using the published JSON Schema files as a gate; changing the refresh cadence (it stays daily at 12:15 UTC); the dead static `/universe` ESI opKeys in `src/lib/esi/opkeys.ts` (they belong to the next `ESI_COMPATIBILITY_DATE` bump).

---

## Stage 1 — Release identity columns
**Mode:** Execute
**Status:** todo
**Goal:** `ap_sde_state` has every column the rest of this plan writes.
**References:** `src/db/schema/ap/sde_state.md`, `src/db/schema.md`
**Touches:** `src/db/schema/ap/sde_state.ts` (+ companion), new migration `0075` via `pnpm db:generate` plus a hand-written `.rollback.sql`.
**Design:** five nullable columns, nothing dropped: `current_release text`, `latest_release text`, `table_versions jsonb`, `full_ingest_at timestamptz`, `schema_changes jsonb`. Nothing reads or writes them in this stage.
**Done when:** `pnpm db:migrate` applies 0075 to the dev DB; the rollback SQL drops the five columns and the migration re-applies cleanly; `pnpm typecheck` passes.

## Stage 2 — SDE API release client
**Mode:** Execute
**Status:** todo
**Goal:** One module can resolve a release index and open any table of it as a decompressed record stream.
**References:** `src/lib/sde/decoders.md`, `src/lib/esi/client.md` (User-Agent convention only)
**Touches:** new `src/lib/sde/release.ts` (+ companion), `src/lib/sde/decoders.ts` (+ companion; add the release-index schema only), new `tests/unit/sde-release.test.ts` (+ companion).
**Design:** additive, nothing wired in yet. The module exposes (a) a release fetch that defaults to `latest` and returns `release`, `buildNumber`, `releaseDate` and, for the ingested tables, each one's `version` and JSONL URL, and (b) a table opener returning a Node readable stream of the decompressed JSONL. The index goes through a Zod decoder: a malformed `release` string, or any ingested table missing or lacking `version` / `jsonl.url`, is an `SdeFormatError`. The list of ingested table names (the nine the ingest reads today) lives here as the single list later stages import and extend. Every request carries `env.EVE_USER_AGENT` and an abort timeout. The module must stay free of `'server-only'` (the job runner and the ingest child are bare `tsx`).
**Done when:** `pnpm test sde-release` passes with `fetch` stubbed, covering: a valid index decodes to the nine versions and URLs; an index missing one ingested table rejects with `SdeFormatError` naming it; a non-2xx index or table response rejects; a table body that errors mid-stream rejects the consumer; the User-Agent header is sent. `pnpm typecheck` passes.

## Stage 3 — Cut the ingest over
**Mode:** Execute
**Status:** todo
**Goal:** Every ingest reads the latest published release from the SDE API, with no zip, cache or pinned build left in the code.
**References:** `src/lib/sde/ingest.md`, `src/lib/sde/decoders.md`, `src/lib/sde/release.md`, `src/lib/jobs/sdeIngestChild.md`, `scripts/sde-ingest-child.md`, `tests/unit/sde-decoders.md`, `tests/integration/jobs/sde-ingest.md`
**Touches:** `src/lib/sde/ingest.ts`, `src/lib/sde/decoders.ts`, `scripts/sde-ingest-child.ts`, `src/lib/jobs/sdeIngestChild.ts`, `src/lib/jobs/tasks/sdeIngest.ts`, `src/lib/jobs/tasks/sdeRefresh.ts` (pin and override removal only), `package.json` + lockfile, `tests/unit/sde-decoders.test.ts`, `tests/unit/sde-zip-cache.test.ts` (deleted, with its companion), `tests/integration/jobs/sde-ingest.test.ts`, `tests/integration/jobs/sde-refresh.test.ts` (the absent-row case only), `tests/db/universe-ingest.test.ts` (it imports `SDE_BUILD` for its title; retitle it and reword its header comment), all affected companions.
**Contract:**
- `runIngest()` takes no argument. It resolves the latest release once and reads all nine tables from that index.
- The parse boundary takes a table opener (table name to stream) rather than a zip path, so it is testable with in-memory streams and still does zero DB access. Records are identified by the named key field per table (see the table above); a record without its key field, or with a non-integer key, is an `SdeFormatError` naming the table.
- The downgrade gate compares the target `release` with `ap_sde_state.current_release`. A null `current_release` passes.
- The success write records `current_release`, `table_versions` and `full_ingest_at` alongside `current_build` / `current_release_date` (taken from the index). `IngestResult` carries the `release`. `runCsvIngest` no longer reports a pinned build.
- Deleted outright: `SDE_BUILD`, `SDE_RELEASE_DATE`, `SDE_ZIP_URL`, `ensureSdeZip`, the zip download, the cache and its eviction, `parseSdeArchive`, the `SDE_INGEST_BUILD` / `SDE_INGEST_RELEASE_DATE` child env vars, and the `node-stream-zip` and `adm-zip` (+ `@types/adm-zip`) dependencies.
- Must not regress: parse-then-write gating, the shrink gate, the advisory lock, key staging and deletion sync, hub proximity, uncatalogued wormhole codes, child-process isolation and its memory ceiling.
- `sde-ingest` calls the child with no held-build resolution. `sde-refresh` stops seeding the state row from the pin (an absent or build-less row counts as behind) and calls the child with no override. It **keeps** comparing build numbers through `fetchLatestSdeManifest` in this stage; Stage 4 replaces that.

**Done when:**
- `pnpm test sde-decoders` passes on in-memory table streams: the valid nine-table set parses to the expected rows, sets and maps; invalid JSON, a non-object line, a record missing its named key field, a renamed required field and a table the opener cannot supply each reject with `SdeFormatError`; the `findShrunkenTables` and `DELETION_SPECS` cases are unchanged.
- `RUN_DB_TESTS=1 pnpm test sde-ingest` and `RUN_DB_TESTS=1 pnpm test sde-refresh` pass.
- `pnpm sde:bootstrap` against the dev DB completes, and `ap_sde_state` then holds a `current_release` equal to the `release` of `https://sde.evetech.net/tranquility/latest/`, nine entries in `table_versions` and a fresh `full_ingest_at`. `RUN_DB_TESTS=1 pnpm test universe-ingest` passes afterwards.
- `git grep -n -E "SDE_BUILD|SDE_RELEASE_DATE|ensureSdeZip|parseSdeArchive|node-stream-zip|adm-zip|sde-cache" -- src scripts tests package.json` returns nothing.

## Stage 4 — Refresh by release and table version
**Mode:** Execute
**Status:** todo
**Goal:** `sde-refresh` decides from the release index whether the database is behind, skipping the ingest when none of the ingested tables changed.
**References:** `src/lib/jobs/tasks/sdeRefresh.md`, `src/lib/sde/status.md`, `src/lib/sde/release.md`, `src/db/schema/ap/sde_state.md`, `tests/integration/jobs/sde-refresh.md`, `tests/unit/sde-status.md`
**Touches:** `src/lib/jobs/tasks/sdeRefresh.ts`, `src/lib/sde/status.ts`, `src/lib/sde/ingest.ts` and `src/lib/sde/decoders.ts` (delete `fetchLatestSdeManifest`, `SDE_LATEST_MANIFEST_URL`, `sdeLatestManifestSchema` only), `aperture.config.ts` (comment wording on the two SDE staleness constants, if it still names the build gap), `tests/integration/jobs/sde-refresh.test.ts`, `tests/unit/sde-status.test.ts`, all affected companions.
**Contract:**
- Each check writes `latest_release`, `latest_build`, `latest_release_date` and `checked_at` from the release index. A failed index fetch still records a failure, as the manifest fetch does today.
- Behind means `current_release` is null or `latest_release > current_release`.
- Behind, and the index's versions for every ingested table equal `table_versions`: advance `current_release` / `current_build` / `current_release_date`, clear `behind_since` and the failure fields, leave `refreshed_at` and `full_ingest_at` alone, spawn nothing.
- Behind, and any version differs, is missing from `table_versions`, or `table_versions` is null: stamp `behind_since` as today and run the ingest child.
- Not behind: unchanged from today (clears `behind_since` and a stale failure).
- `getSdeStatus` derives `behind` from the release columns. Its three states and both staleness clocks are otherwise unchanged.

**Done when:**
- `RUN_DB_TESTS=1 pnpm test sde-refresh` passes with the release fetch and the child mocked, covering: not behind (no child); behind with identical table versions (no child, `current_release` advanced, `refreshed_at` untouched); behind with one differing version (child called); behind with a table absent from `table_versions` (child called); behind with null `table_versions` (child called); the `behind_since` hold-and-clear sequence; a rejecting child recording the failure with `current_release` untouched; an absent state row.
- `pnpm test sde-status` passes with `behind` driven by releases, including a legacy row that has `current_build` but a null `current_release`.
- `git grep -n -E "latest\.jsonl|fetchLatestSdeManifest|sdeLatestManifestSchema|SDE_LATEST_MANIFEST_URL" -- src scripts tests` returns nothing.

## Stage 5 — Effects and Drifter classes from the SDE
**Mode:** Execute
**Status:** todo
**Goal:** `universe_system.effect` and the Drifter security labels are derived from the ingested release instead of vendored constants (fixes #225).
**References:** `src/lib/sde/ingest.md`, `src/lib/sde/decoders.md`, `src/lib/sde/release.md`, `src/lib/sde/security.md`, `src/lib/eve/systemEffectAssignments.md`, `tests/unit/sde-decoders.md`
**Touches:** `src/lib/sde/release.ts` (ingested-table list gains `mapSecondarySuns`), `src/lib/sde/decoders.ts`, `src/lib/sde/ingest.ts`, `src/lib/sde/security.ts`, `src/lib/eve/systemEffects.ts` (the beacon-type map), `src/lib/eve/systemEffectAssignments.ts` (deleted, with its companion), `src/lib/eve/drifterSystems.ts` (drop `drifterClassLabel` and whatever only it used; the short names stay), `tests/unit/sde-decoders.test.ts`, all affected companions.
**Contract:**
- `mapSecondarySuns` is the tenth ingested table: decoded through a Zod schema (`sunID` key; `solarSystemID`, `effectBeaconTypeID` required), read from the same release index as the rest. It feeds `universe_system.effect` only; no new `universe_*` table, no deletion spec.
- The effect comes from `effectBeaconTypeID` through a fixed 36-entry map to `SystemEffectKey` (ids in the header). The sun `typeID` is not consulted. A beacon type outside the map fails the ingest before any write (`SdeGateError('binding')`), the same way an unresolvable CSV row does. A system with no secondary sun has a null effect.
- The count of systems carrying an effect is shrink-gated against the live count with `SDE_REFRESH_MAX_SHRINK_PCT`, so an empty or truncated `mapSecondarySuns` cannot silently null every effect.
- The security label reads the system-level `wormholeClassID` when present and the constellation's otherwise. Outside the wormhole region range the class is already ignored, so the 687 k-space systems carrying a system-level class are unaffected.
- A deployment upgrading across this stage holds no `mapSecondarySuns` entry in `table_versions`, so its next refresh runs one full ingest (Stage 4's "missing from `table_versions`" rule).

**Done when:**
- `pnpm test sde-decoders` passes with added cases: a secondary sun sets its system's effect from the beacon; a sun whose `typeID` and beacon disagree takes the beacon's effect; an unknown beacon type rejects before any write; a wormhole-region system with a system-level class 14–18 is labelled `C14`–`C18`; a k-space system with a system-level class keeps its status-derived label.
- Snapshot `select id, effect, security from universe_system` on the dev DB, run `pnpm sde:bootstrap`, and diff, for systems present in both: **no row differs in `security`** (the five Drifter systems read `C14`–`C18`), and **exactly two rows differ in `effect`**: `31002508` from `pulsar` to `redGiant` and `31002509` from `redGiant` to `wolfRayet`. 1,038 systems carry an effect. `table_versions` holds ten entries.
- `git grep -n -E "SYSTEM_EFFECT_BY_ID|systemEffectAssignments|drifterClassLabel" -- src tests scripts` returns nothing.

## Stage 6 — Delta planning
**Mode:** Execute
**Status:** todo
**Goal:** Given a release's `_changes` and the database's recorded state, a pure function decides whether the release can be applied as a delta and with which keys.
**References:** `src/lib/sde/release.md`, `src/lib/sde/decoders.md`, `src/db/schema/ap/sde_state.md`
**Touches:** `src/lib/sde/release.ts` (fetch and decode `_changes`; fetch one record by table and key through the index's `record.urlTemplate`), `src/lib/sde/decoders.ts` (the `_changes` schema), new `src/lib/sde/delta.ts` (+ companion; the planner only), `aperture.config.ts` (`SDE_DELTA_MAX_RECORDS: 500`, `SDE_FULL_INGEST_MAX_AGE_DAYS: 30`), new `tests/unit/sde-delta.test.ts` (+ companion), `tests/unit/sde-release.test.ts`, affected companions.
**Design:** additive, nothing wired in. The planner returns either the per-table key sets to fetch or `full` with a reason string fit for job notes. It answers `full` unless **every** rule holds:
1. `_changes.comparedWith` names exactly `ap_sde_state.current_release` on the `tranquility` tenant.
2. `full_ingest_at` is set and younger than `SDE_FULL_INGEST_MAX_AGE_DAYS`.
3. None of the map tables (`mapRegions`, `mapConstellations`, `mapSolarSystems`, `mapStargates`, `mapSecondarySuns`) appears in `_changes` at all.
4. No item table (`categories`, `groups`, `dogmaAttributes`, `types`, `typeDogma`) carries `removed` keys or any of `schemaChanged` / `fileAdded` / `fileRemoved` / `fileRenamed`.
5. `_changes` and the index agree: an ingested table is listed in `_changes` if and only if its index `version` differs from `table_versions`.
6. The keys to fetch (the union of `added`, `changed` and `changedLocalization` per item table) total at most `SDE_DELTA_MAX_RECORDS`, and every one is an integer key.

**Done when:** `pnpm test sde-delta` passes with one case per rule (each violated alone yields `full` with a distinct reason), plus the eligible case returning the deduplicated key sets, including a key present in both `changed` and `changedLocalization`. `pnpm test sde-release` covers the `_changes` decode (valid, and a malformed record rejecting with `SdeFormatError`) and the single-record fetch. `pnpm typecheck` passes.

## Stage 7 — Delta application
**Mode:** Execute
**Status:** todo
**Goal:** `sde-refresh` applies an eligible release as one small transaction and falls back to the full ingest whenever it cannot.
**References:** `src/lib/sde/ingest.md`, `src/lib/sde/delta.md`, `src/lib/sde/release.md`, `src/lib/jobs/sdeIngestChild.md`, `scripts/sde-ingest-child.md`, `src/lib/jobs/tasks/sdeRefresh.md`, `src/lib/jobs/tasks/sdeIngest.md`
**Touches:** `src/lib/sde/ingest.ts`, `src/lib/sde/delta.ts`, `scripts/sde-ingest-child.ts`, `src/lib/jobs/sdeIngestChild.ts`, `src/lib/jobs/tasks/sdeRefresh.ts`, `src/lib/jobs/tasks/sdeIngest.ts`, new `tests/db/sde-delta-apply.test.ts` (+ companion), `tests/unit/sde-delta.test.ts`, `tests/integration/jobs/sde-refresh.test.ts` and `tests/integration/jobs/sde-ingest.test.ts` (the mode each task passes), all affected companions.
**Contract:**
- The ingest takes a mode. `full` always runs the full ingest: `pnpm sde:bootstrap` and the `sde-ingest` task use it. `auto` may take the delta path: only `sde-refresh` uses it. The mode crosses the child-process boundary.
- In `auto`, under the same advisory lock and after the downgrade gate, the Stage 6 planner runs. When it answers with key sets, each record is fetched individually and decoded with the same Zod schema the full path uses for that table.
- **One row mapping.** The row a record becomes is produced by the same function in both paths, so a delta can never write a row the full ingest would have written differently.
- A fetched `types` record in group `988` abandons the delta: wormhole types feed the CSV binding and the uncatalogued-code report, which only the full path maintains.
- The write is a single transaction: upsert categories, groups, dogma attributes and types in FK order; for each fetched `typeDogma` record replace that type's attribute rows, skipping type and attribute ids absent from their tables exactly as the full path does; then advance `current_release` / `current_build` / `current_release_date` / `table_versions` / `refreshed_at` and clear `behind_since` and the failure fields. `full_ingest_at` is not touched.
- The delta path never deletes from a `universe_*` table other than the attribute rows it replaces, and never touches map tables, CSV-derived tables, key staging, deletion sync, the shrink gate or hub proximity.
- Any failure before the commit (planner says `full`, a record fetch or decode fails, a group-988 type, an FK violation) leaves the database untouched and continues into the full ingest in the same run. `IngestResult` reports which path ran and, on a fallback, why.

**Done when:**
- `pnpm test sde-delta` gains a parity case: for each item table, a record mapped through the delta path yields the same row as the full parse of a one-record table.
- `RUN_DB_TESTS=1 pnpm test sde-delta-apply` passes against the dev DB with the release client stubbed and every synthetic row and the `ap_sde_state` singleton restored afterwards, covering: a delta adding a type with dogma and renaming an existing type lands both, leaves an untouched type byte-identical, advances `current_release` and `table_versions`, and leaves `full_ingest_at` alone; a delta whose type references a missing group commits nothing and enters the full path (asserted on a spy, not a real download); a group-988 type enters the full path with nothing written.
- `RUN_DB_TESTS=1 pnpm test sde-refresh` and `sde-ingest` pass, asserting `auto` and `full` respectively.

## Stage 8 — Schema changelog capture
**Mode:** Execute
**Status:** todo
**Goal:** `ap_sde_state` holds FC's recent schema changes for the ingested tables, refreshed by the daily check.
**References:** `src/lib/sde/release.md`, `src/lib/sde/decoders.md`, `src/lib/jobs/tasks/sdeRefresh.md`, `src/db/schema/ap/sde_state.md`
**Touches:** `src/lib/sde/release.ts`, `src/lib/sde/decoders.ts`, `src/lib/jobs/tasks/sdeRefresh.ts`, `src/types/index.ts` (the stored shape), `tests/unit/sde-release.test.ts`, `tests/integration/jobs/sde-refresh.test.ts`, affected companions.
**Contract:**
- `schema_changes` stores `{ version, entries }`: `version` is the `_schemaChangelog` table version it was read at, `entries` the changelog items that touch an ingested table, reduced to those tables, newest first, capped at ten.
- The check fetches `_schemaChangelog` only when its index version differs from the stored one.
- The changelog is context, never a gate: a failed fetch or decode of it is logged and leaves the previous `schema_changes` in place, and the check carries on to its comparison.

**Done when:** `pnpm test sde-release` covers the changelog decode and the reduction to ingested tables; `RUN_DB_TESTS=1 pnpm test sde-refresh` covers: a changed changelog version rewrites `schema_changes`; an unchanged version fetches nothing; a rejecting changelog fetch leaves the stored value and the rest of the check intact.

## Stage 9 — Operator surface and cleanup
**Mode:** Execute
**Status:** todo
**Goal:** `/setup`, the README and the deployment files describe the release-based ingest that now exists.
**References:** `src/app/(setup)/setup/page.md`, `src/components/setup/RunSdeIngestCard.md`, `src/components/setup/RunSdeRefreshCard.md`, `src/db/schema/ap/sde_state.md`
**Touches:** `src/app/(setup)/setup/page.tsx` (the static-data panel: release id next to each build, last full ingest, recent upstream schema changes from `schema_changes`), `src/components/setup/RunSdeIngestCard.tsx`, `src/components/setup/RunSdeRefreshCard.tsx`, `src/components/setup/RunCsvIngestCard.tsx` (its description mentions the SDE zip), `src/app/(setup)/actions.ts` (doc comments on the two SDE actions), `README.md` (the "Static data (SDE)" section), `docker-compose.yml` (drop the `sdecache` volume and its comment), `.gitignore`, `.dockerignore`, `CLAUDE.md` ("How to Find Things": add `src/lib/sde/release.md` and `src/lib/sde/delta.md` to the static-data row), all affected companions.
**Copy rules:** no em-dashes in user-facing or README text; write "FC", not "CCP", in new text. The README must say: the first ingest can be started from either card (a database with no recorded release always counts as behind); there is no pinned build; the daily refresh applies most releases as a small delta and runs a full ingest when map data changes and at least every 30 days; the repair card always runs a full ingest; a deployment upgrading across this change runs one full ingest on its first refresh; an existing `sdecache` volume can be removed.
**Done when:** the `ci-verifier` gate is green; `git grep -n -i -E "pinned|sde-cache|sdecache|SDE zip|bootstrap build" -- README.md docker-compose.yml .gitignore .dockerignore "src/app/(setup)" src/components/setup` returns nothing.

## Manual verification
_(worked by the user once, after the run — the plan is not complete until it passes)_
- **Stage 3** — on the deployed dev instance, run the re-ingest card from `/setup` with a map open and a tracked character moving: the `ap_job_run` row succeeds with per-table counts, the realtime banner stays green throughout, and breadcrumbs keep flowing.
- **Stage 4** — after the next 12:15 UTC tick on the deployed dev instance, `/setup` shows current and latest on the same release.
- **Stage 5** — on a map, J005926 shows a Red Giant effect and J010569 a Wolf-Rayet effect, matching the game (issue #225). Close the issue once the deployed instance has ingested.
- **Stage 7** — on the deployed dev instance, after a release that touches only item tables, the `sde-refresh` job notes report the delta path, the run takes seconds, and the changed types are present in `universe_type`. After a release that touches a map table, the notes report a full ingest with the reason.
- **Stage 9** — `/setup` reads correctly: release ids, last full ingest and recent schema changes are shown, and the two cards explain the difference between "refresh, by delta when possible" and "full re-ingest regardless".
- **Stage 9** — follow the README's first-deploy steps against an empty database (`docker compose up` with fresh volumes) and confirm the `universe_*` tables populate without a `.sde-cache` volume.

## Notes
_(appended by executing sessions — non-obvious findings only)_
- (planning) `pnpm db:migrate`, `pnpm sde:bootstrap` and `pnpm sde:csv` need `DATABASE_URL` exported from `.env` by hand in a shell; the dev DB container can also lose host port 5432 to other projects.
- (planning) Run `pnpm install` / `pnpm remove` from PowerShell, not the POSIX Bash tool: the Bash tool lowercases the `D:\DEV` path and breaks Turbopack's case-sensitive root check on the next build.
- (planning) `RUN_DB_TESTS` suites run against the live, non-pristine dev DB. Suites that touch the `ap_sde_state` singleton or write synthetic `universe_*` rows must snapshot and restore them, as the existing SDE suites do.
- (planning) The blob `ETag` equalling the index `version`, and the `/blobs/<version>.jsonl` path, are observed behaviour and not documented by FC. Nothing should depend on either; always go through the URLs the index gives.
- (planning) FC's human-readable changelog page (https://developers.eveonline.com/static-data) is rendered client-side from `…/static-data/tranquility/schema-changelog.yaml` and the per-build `…/changes/<build>.jsonl` files. Those belong to the zip distribution; the plan reads the API's `_changes` and `_schemaChangelog` tables instead, which carry the same information.
