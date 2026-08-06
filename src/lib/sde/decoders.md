## decoders.ts

**Purpose:** Zod decoders for the SDE JSONL entry shapes `parseSdeArchive` reads, so CCP's periodic SDE reorganizations fail as a decode error instead of an `undefined` cast.
**File:** `src/lib/sde/decoders.ts`

---

### `sdeCategorySchema` / `sdeGroupSchema` / `sdeDogmaAttributeSchema` / `sdeTypeSchema` / `sdeTypeDogmaSchema` / `sdeRegionSchema` / `sdeConstellationSchema` / `sdeSolarSystemSchema` / `sdeStargateSchema`
One schema per SDE JSONL file (`categories.jsonl`, `groups.jsonl`, `dogmaAttributes.jsonl`, `types.jsonl`, `typeDogma.jsonl`, `mapRegions.jsonl`, `mapConstellations.jsonl`, `mapSolarSystems.jsonl`, `mapStargates.jsonl`). Each is `.loose()` — only the fields the ingest maps onto a `universe_*` column are declared; everything else in the SDE entry (including `_key`) passes through unvalidated. A field required by a schema is one the ingest has no fallback for (`name`, `groupID`/`categoryID`, `securityStatus`); fields the ingest already treats as optional (`published`, `position`, dogma attribute metadata) stay `.optional()`.

`localizedSchema` accepts either a bare value or a `{ [locale]: value }` map — the SDE's two shapes for localized text — where a value is a string or a number, as boundary tolerance for a numeric-looking name arriving unquoted; `en()` (`ingest.ts`) coerces to string.

### `sdeLatestManifestSchema`
One line of `<SDE_BASE>/latest.jsonl`, the newline-delimited build-freshness manifest `fetchLatestSdeManifest` (`ingest.ts`) polls: `_key`, `buildNumber`, `releaseDate`. `.loose()` — the manifest carries entries for other keys the ingest doesn't read.

### `SdeFormatError`
Thrown by `decodeJsonlEntries` when one line fails its schema, isn't a JSON object, is missing `_key`, or can't be parsed as JSON at all. Carries `file`, `entryKey`, and `cause` (a `ZodError` or a plain message); the error message names the file, the entry, and the failing field path.

### `decodeJsonlEntries(file, stream, schema, onEntry): Promise<void>`
Streams a `.jsonl` SDE entry one line at a time straight off a `NodeJS.ReadableStream`: `JSON.parse`s the line, reads its `_key` as the record id, `safeParse`s the line against `schema`, and calls `onEntry(id, entry)` before moving to the next line. Never holds more than one decoded line, the current chunk's unconsumed tail, a whole-file document graph, an intermediate `Map` of validated entries, or a whole-entry buffer in memory. Throws `SdeFormatError` for a line that isn't valid JSON, isn't a JSON object, has no `_key`, or fails `schema`; rejects with the stream's error on a read failure.
