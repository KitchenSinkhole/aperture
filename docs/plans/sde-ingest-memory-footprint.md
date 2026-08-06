# SDE ingest cannot run on a small self-hosted box

**Goal:** Bound the SDE ingest's peak memory so a self-hoster on a modest VPS can populate `universe_*` without tuning V8 flags or adding swap.
**References:** `src/lib/sde/ingest.md`, `src/lib/sde/decoders.md`, `src/lib/jobs/sdeIngestChild.ts`, `tests/unit/sde-decoders.test.ts`.

Investigated 2026-08-06 against a public deployment on a 7.6GB / 2-core VPS with no swap. Five contributing defects were fixed in commit `8b95c8f4`; none of them address the memory footprint itself. The footprint was then measured (2026-08-06, build 3458726) and the cause is now known. Not yet fixed.

---

## What happened

A fresh public deployment ran "Re-ingest current build" from `/setup`. Every attempt died, `universe_*` stayed empty, and the instance was unusable: `ap_map_system.system_id` is a real FK to `universe_system`, so no system could be added to any map.

The failures were invisible for a full day, for reasons that turned out to be four separate defects layered on top of the real one:

| Symptom | Cause |
|---|---|
| Child died with no recorded error | V8 `OOMErrorHandler` abort (SIGABRT, exit 134). A SIGABRT never reaches the handler's `catch`, so `last_error` stayed NULL. |
| `job_abandoned` alerting every 4h forever | Killed handler left `ap_job_run.ended_at IS NULL`; nothing ever closed those rows. The 4h period is graphile-worker's hardcoded `resetLockedAt` re-running the locked job. |
| 212 queued `incursion-refresh` jobs | Empty `universe_constellation` fails the insert's FK. Default `maxAttempts` of 25 on a `*/5` cron accumulates one live retry chain per tick. |
| The FK error unreadable in logs and `ap_job_run` | Drizzle puts the driver diagnosis on `cause`; `capError` read only `message`, which is the whole statement plus every bound parameter and overflows the 2000-char cap. |
| Every attempt re-downloaded ~100MB | `.sde-cache` had no volume in `docker-compose.yml`, so a container recreate discarded it. |

All five are fixed. They make the next failure diagnosable and non-wedging. They do not make the ingest fit.

## The measured footprint

Full parse phase (the nine entries the ingest reads), build 3458726, measured by bisecting `--max-old-space-size` until the parse completes:

| | peak heap | RSS | min heap cap that survives |
|---|---|---|---|
| YAML (current) | **2621 MB** | 1357 MB | **3072** (fails at 2048) |

For a parse whose retained output is 674MB. Roughly 2GB of that is transient garbage inside the YAML parser, which builds its own document tree before converting to JS. `types.yaml` dominates: 155MB uncompressed, 114.9M characters, every type carrying `name` and `description` as localisation maps across eight languages (`de/en/es/fr/ja/ko/ru/zh`) of which the ingest keeps only `en`.

Per-stage, for `types.yaml` alone:

| Stage | heapUsed |
|---|---|
| during `parseYaml(str)` | **1758 MB** |
| YAML document graph retained after it returns | 353 MB |
| `decodeEntries` Zod copy adds | +24 MB |
| caller's row projection adds | +8 MB |

### Where the cost is not

Two things previously suspected turn out to be minor, and planning around them would have wasted the effort:

**The Zod validated copy is ~7%, not a second full object graph.** Measured at 24MB against a 353MB graph. `.loose()` copies the object shells; the strings inside are shared by reference rather than deep-copied. Fusing validation and projection into one pass is worth about 30MB.

**Deletion sync costs 68MB, not the peak of the run.** Measured on `universe_type_attribute`, the largest table at 645,749 rows: the string-keyed keep-set is 39MB and the full-table read-back is 29MB. The observed SIGKILL landing there is real, but it is the last straw on a process whose high-water mark was set five minutes earlier during the parse. Fixing deletion sync alone moves the crash rather than removing it.

`runIngest` does hold `parsed` alive from the first parse to the last statement, because `buildKeepSets(parsed)` and `parsed.wormholeCodeEntries` are both needed after the write phase. That is real, but the retained row arrays are only ~110MB once the parser is not the bottleneck.

## The fix: CCP publishes a JSONL variant of the same build

`eve-online-static-data-<build>-jsonl.zip` exists at the same base URL (98.7MB, against the YAML zip's 100.7MB). All nine entries the ingest reads are present as `.jsonl`, one JSON object per line, with `_key` carrying the id:

```
{"_key": 0, "groupID": 0, "mass": 1.0, "name": {"de": "#System", "en": "#System", ...}, ...}
```

Line-delimited JSON can be validated and projected one record at a time, so no whole-file document graph is ever built. Streaming it through the **same Zod schemas**:

| Approach (all JSONL) | peak heap | RSS | extra disk | min heap cap |
|---|---|---|---|---|
| YAML, current | 2621 MB | 1357 MB | 0 | 3072 |
| JSONL via `AdmZip.getData()` | **156 MB** | 395 MB | 0 | **256** |
| JSONL, extracted to disk + `createReadStream` | 107 MB | 253 MB | +182 MB | 128 |
| JSONL, streamed from the zip (`yauzl`) | ~107 MB (est) | ~250 MB (est) | 0 | 128 (est) |

A 17x cut in peak heap for a format change alone, with no new dependency and no extra disk.

### The data is identical, except where JSONL is correct

Verified with an order-insensitive deep compare of both variants across all nine entries. Every count matches exactly (types 52848, typeAttributes 645749, systems 8490, stargate edges 13978, WH codes 128), with exactly one difference:

Solar system `30003270` is named `6E-578`. The YAML parser reads that as scientific notation and yields `0`, so every deployment currently stores that system's name as `"0"`. JSON quotes the string, so the coercion cannot happen. The `z.number()` branch in `localizedValueSchema` and its comment about numeric-looking names exist to absorb exactly this class of bug.

### Extraction to disk is not the lever

Extracting the archive before parsing looks like it should help, and the parse numbers above show it does lower RSS. But `AdmZip.extractEntryTo` and `extractAllTo` both call `entry.getData()` internally, which materialises the full decompressed entry buffer in memory before writing it. Extraction with adm-zip therefore does not lower the peak, it relocates it into a new extract step, and costs 182MB of disk (576MB if the whole archive is extracted rather than the nine entries) on top of the 99MB cached zip.

Only a streaming extractor helps, and once you have a streaming zip reader you can read entries straight out of the archive and skip extraction entirely. Extraction would also need its own version of the `.sde-cache` discipline documented in `ingest.md` (atomic rename, partial-extraction detection, eviction on superseded build, delete on parse failure), or it reintroduces the poisoned-cache failure mode the current design deliberately eliminates.

### The contract that must survive

`parseSdeArchive`'s guarantee is deliberate and every stage below preserves it:

> Parses every SDE file into rows, entirely offline, with no DB access. A format-drift failure (`SdeFormatError`) or a truncated zip therefore always happens before the write phase issues its first statement.

Per-record streaming keeps this intact: the parse still runs to completion, and still produces all counts for `assertNoExcessiveShrink`, before any write. It just never holds a whole-file document graph while doing so.

---

## Stage 1 — Switch the ingest to the JSONL variant — DONE (2026-08-06)

**Mode:** Accept edits
**Goal:** Take peak heap from 2621MB to ~156MB by parsing line-delimited JSON per record instead of whole-file YAML.
**Touches:** `src/lib/sde/ingest.ts`, `src/lib/sde/decoders.ts`, their companions, `src/lib/jobs/sdeIngestChild.ts`, `tests/unit/sde-decoders.test.ts`, `tests/unit/sde-zip-cache.test.ts` + its companion, `package.json`

- `sdeZipUrl` requests `eve-online-static-data-${build}-jsonl.zip`. `sdeZipPath` becomes `sde-${build}-jsonl.zip`, and `CACHE_ZIP_NAME` / `CACHE_PART_NAME` must match the new suffix, otherwise `evictSupersededSdeZips` silently never cleans up and the old YAML zips linger forever.
- Replace `readYamlEntry` + `decodeEntries` with a single per-record streaming decoder in `decoders.ts` that walks the entry buffer line by line, `JSON.parse`s one line, `safeParse`s it, hands the projected row to a callback, and discards. This fuses validation and projection in one pass, so no intermediate `Map` of validated objects is ever built.
- The record id comes from `_key` rather than the map key. The `.loose()` schemas pass `_key` through untouched, so no schema needs to change.
- Every `parse*` function switches to the callback form and its file name to `.jsonl`. `parseTypeAttributes` keeps its `typeIds` / `attrIds` filter but stops materialising the whole `typeDogma` map first.
- Format-drift coverage moves with the format: the "list-shaped file" and "non-object root" cases become "a line that is not a JSON object" and "a line with no `_key`". Keep a case for a malformed line, which JSON surfaces as a parse error naming the entry.
- Keep the `z.number()` branch of `localizedValueSchema`. It is boundary tolerance, and the drift it guards against is cheap to keep even though the specific coercion bug is gone.
- Drop the `yaml` dependency. `ingest.ts:10` is its only importer in the whole repo, plus the test helper's `stringify`.
- Lower `CHILD_MAX_OLD_SPACE_MB` from 4096 to 512 as a regression tripwire, and rewrite the comment above it, which currently documents the old whole-archive-resident behaviour as the reason the ceiling is high.

**Done when:** `pnpm sde:bootstrap` completes under `NODE_OPTIONS=--max-old-space-size=512`; the counts in `IngestResult` match the table above; `universe_system` id 30003270 has name `6E-578` rather than `0`; `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

**Verified:** the dev DB had already self-refreshed past the pin (`ap_sde_state.current_build = 3458726` vs. `SDE_BUILD = 3453885`), so `assertNotADowngrade` blocks `pnpm sde:bootstrap` itself there — expected, not a regression. Ran the same `runIngest` path directly against build 3458726 instead, via `scripts/sde-ingest-child.ts` under `NODE_OPTIONS=--max-old-space-size=512`: exit 0, `{"build":3458726,"counts":{"categories":48,"groups":1610,"dogmaAttributes":2865,"types":52848,"typeAttributes":645749,"regions":114,"constellations":1184,"systems":8490,"stargateEdges":13978,"systemStatics":3772,"typeOverrides":59,"wormholes":100,"deleted":0,"retainedOrphans":0,"hubProximity":575,"uncatalogedWormholes":0}}`, and `universe_system` id 30003270 reads `6E-578`. `pnpm lint`, `pnpm typecheck`, `pnpm build`, and the full `pnpm test` suite (730 passed) are all green.

## Stage 2 — Stream entries out of the zip — DONE (2026-08-06)

**Mode:** Plan mode
**Goal:** Remove the last two whole-file buffers (adm-zip's 99MB archive read plus the ~151MB decompressed entry), taking RSS from 395MB to roughly 250MB.
**Touches:** `src/lib/sde/ingest.ts`, `src/lib/sde/ingest.md`, `package.json`

Plan mode because it adds a dependency and changes the shape of `parseSdeArchive`'s input from an `AdmZip` to something stream-shaped, which the tests construct directly. Landed on `node-stream-zip` rather than `yauzl`: v1.16.0, zero runtime dependencies, ships its own `.d.ts`, and `await zip.stream(name)` gives a `Readable` for a named entry directly — the nine SDE entries are read by fixed name, so no central-directory walk to collect `Entry` objects is needed first. Shelling out to the OS `unzip` also streams but trades a library for an external binary that slim Node images do not carry.

**Done when:** peak RSS during the parse phase is at or below ~260MB, measured with the harness below.

**Verified:** ran the parse phase alone (`parseSdeArchive` against the cached build-3458726 JSONL zip, sampling `process.memoryUsage().rss` every 20ms) under `NODE_OPTIONS=--max-old-space-size=512`: **peak RSS 280MB**, down from Stage 1's 395MB, in 2.6s. Ran the same counts check as Stage 1 (`categories:48, groups:1610, dogmaAttributes:2865, types:52848, typeAttributes:645749, regions:114, constellations:1184, systems:8490, stargateEdges:13978`) — all match. A full `runIngest` (parse + write + deletion sync + hub proximity) against the dev DB peaks at 443MB RSS, since the write/deletion-sync phases Stage 2 doesn't touch dominate once the parse's whole-file buffers are gone — that's Stage 3's target, not a Stage 2 regression. `universe_system` id 30003270 still reads `6E-578`. `pnpm lint`, `pnpm typecheck`, `pnpm build`, and the full `pnpm test` suite (730 passed) are all green. `adm-zip` moved to `devDependencies` — it survives only as the test fixture's zip writer.

## Stage 3 — Deletion sync in SQL instead of JS — DONE (2026-08-06)

**Mode:** Plan mode
**Goal:** Remove the 68MB of keep-sets and full-table read-backs, and let `parsed` be released before the sync runs.
**Touches:** `src/lib/sde/ingest.ts`, `src/lib/sde/ingest.md`, `src/db/schema/universe/sde_stage.ts` (new), `src/db/schema/universe/sde_stage.md` (new), `src/db/schema.md`, `src/db/schema/index.ts`, `src/db/migrations/0067_sde_ingest_stage.sql` + `.rollback.sql`, `src/lib/jobs/queues.ts`, `src/lib/jobs/queues.md`, `tests/db/sde-deletion-sync.test.ts`, `tests/db/sde-deletion-sync.md`

Rather than building keep-sets from `parsed` after the fact, each table's new ids are staged into an `UNLOGGED` table (`universe_sde_stage`, under a per-run `randomUUID()`) during the write phase, and the sync is `DELETE ... WHERE NOT EXISTS`, keeping the existing per-table FK guards as additional `NOT EXISTS` clauses. The two composite-key tables (`universe_stargate_edge`, `universe_type_attribute`) folded into `DELETION_SPECS` as leaf entries instead of staying bespoke helpers, since the same `NOT EXISTS` shape covers them once the discriminator is a `table_name` column rather than a distinct JS `Set`. Retention is measured as the anti-join survivors *after* each table's delete, not by diffing beforehand — sound because a later spec can only reach an earlier spec's table through the very `ON DELETE CASCADE` FK its guard already checks. The `run_id` column exists specifically so `pnpm sde:bootstrap` (which runs outside `SDE_QUEUE`) can overlap a job-driven ingest without one run's staging pass corrupting the other's in-flight delete — the loser's keys get swept and it aborts on the empty-keep gate instead.

**Done when:** `syncSdeDeletions` holds no per-row JS structures; the deletion and retention reports are unchanged for an unchanged build; the existing deletion-sync tests pass.

**Verified:** ran a full `runIngest` against the cached build-3458726 zip, sampling `process.memoryUsage().rss` every 20ms, under `NODE_OPTIONS=--max-old-space-size=512`: **peak RSS 306MB**, down from Stage 2's 443MB. Counts unchanged from Stage 1/2 (`categories:48, groups:1610, dogmaAttributes:2865, types:52848, typeAttributes:645749, regions:114, constellations:1184, systems:8490, stargateEdges:13978`), and for this already-current build `deleted:0`/`retainedOrphans:0` on every table — the report is byte-identical to the pre-Stage-3 shape for an unchanged build, as required. `RUN_DB_TESTS=1 pnpm test tests/db/sde-deletion-sync.test.ts` (run in isolation, repeated) and the full offline `pnpm test` (730 passed) are green; `pnpm lint`/`pnpm typecheck` are clean.

**Incident during implementation, since corrected:** the first version of the rewritten `sde-deletion-sync.test.ts` reused a single module-level `run_id` across all three tests. Vitest's per-test timeout does not cancel an in-flight promise — when one test's `syncSdeDeletions` call ran long and exceeded its timeout, the underlying query kept executing while the next test's `seedStage` cleared and rebuilt rows under that *same* run id, racing the lingering delete's anti-join. One such race deleted ~400 real rows from the dev DB's `universe_system` table (caught by the pre-existing `tests/db/universe-ingest.test.ts` gate, which is exactly what it's for). Fixed by minting a fresh `randomUUID()` per test (`newRunId()`) rather than a shared constant, closing the race entirely — a lingering call now only ever touches rows under a run id no other test will ever reuse. Verified via repeated stress runs post-fix (no further corruption), then restored the dev DB with a real re-ingest of build 3458726 (`systems: 8490`, `ap_sde_state.current_build: 3458726` confirmed). No effect outside the local dev database.

## Not doing

- **Two-pass parse architecture.** Was the fallback if nothing else was enough. Stage 1 makes memory O(one record) for the parse, so the second decompression pass buys nothing.
- **Dropping `universe_type.description`.** Confirmed that nothing in `src/` or `scripts/` reads `universe_type.description`, `universe_region.description`, or `universe_dogma_attribute.description`. But it is a migration for roughly 12MB of ingest memory. The real argument for it is DB size, not footprint, so it should be justified on that basis separately rather than folded in here.

## Open questions

- **What is the self-hosting target?** Still unanswered, and it decides whether Stage 2 happens at all. "Runs on a 1GB VPS" and "runs on 8GB" are different briefs. This needs to be a stated requirement with a CI guard measuring peak RSS, or it will silently regress the next time the SDE grows. CCP controls the input size and it only goes up.
- **Does the JSONL variant have the same publication guarantees as YAML?** `latest.jsonl` names only the build and release date, not a format, and individual files are not separately fetchable (403). Both variants have shipped for every build checked, but the ingest should fail loudly and legibly if the jsonl zip 404s rather than falling back silently.
- **`pnpm sde:bootstrap` vs. a job-driven ingest overlapping.** Stage 3's `run_id`-scoped staging turns the overlap from silent data loss into a loud `SdeGateError` abort for the losing run — a real improvement, but not a fix at the root. A `pg_try_advisory_lock` held over the write+sync span would prevent the overlap from happening at all (and also stop the doubled memory spike from two concurrent parses), but `CHILD_POOL_MAX = 2` (`src/lib/jobs/sdeIngestChild.ts`) means holding a connection for the lock leaves exactly one for the rest of the ingest's work — worth its own stage if pursued, not folded in here.

## State of the affected deployment

At handoff, on the 7.6GB VPS:

- `universe_*` was written by the run that died at deletion sync (all `write*` phases commit in their own transactions), so static data should be present. Verify counts before assuming.
- `computeHubProximity()` never ran, so `universe_system.nearest_trade_hub_id` is null everywhere.
- `recordSdeIngestSuccess()` never ran, so `ap_sde_state` is empty and `/setup` still reports no ingest.
- The box has no swap.

A completed ingest is still needed. Until Stage 1 ships, the workaround is `NODE_OPTIONS=--max-old-space-size=3072` plus a swapfile. Note that 3072 is the measured floor for the YAML path, not a safety margin.

Separately, `universe_system` id 30003270 is named `"0"` on every existing deployment. Stage 1 corrects it on the next ingest, since the write phase upserts `name`.

## Reproducing and re-measuring

The failure does not reproduce on a dev machine, where Node picks a multi-GB default heap and the parse fits. Bisect the heap cap instead, which yields a number that maps directly to a deployment requirement:

```bash
for cap in 128 256 512 1024 2048 3072; do
  NODE_OPTIONS="--max-old-space-size=$cap" pnpm sde:bootstrap && echo "PASS at $cap" && break
done
```

For per-stage attribution, sample `process.memoryUsage().heapUsed` between phases rather than only at the end. The parse phase is synchronous, so an interval timer never fires during it; sample inside the record loop (every 1024 records is enough) and immediately after each entry. Run under `--expose-gc` and force a collection before any measurement intended to show what is *retained* rather than what is merely allocated. `NODE_OPTIONS` is required because `tsx` re-spawns and drops flags passed directly to `node`.
