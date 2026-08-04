## decoders.ts

**Purpose:** Zod decoders for the SDE YAML entry shapes `parseSdeArchive` reads, so CCP's periodic SDE reorganizations fail as a decode error instead of an `undefined` cast.
**File:** `src/lib/sde/decoders.ts`

---

### `sdeCategorySchema` / `sdeGroupSchema` / `sdeDogmaAttributeSchema` / `sdeTypeSchema` / `sdeTypeDogmaSchema` / `sdeRegionSchema` / `sdeConstellationSchema` / `sdeSolarSystemSchema` / `sdeStargateSchema`
One schema per SDE YAML file (`categories.yaml`, `groups.yaml`, `dogmaAttributes.yaml`, `types.yaml`, `typeDogma.yaml`, `mapRegions.yaml`, `mapConstellations.yaml`, `mapSolarSystems.yaml`, `mapStargates.yaml`). Each is `.loose()` — only the fields the ingest maps onto a `universe_*` column are declared; everything else in the SDE entry passes through unvalidated. A field required by a schema is one the ingest has no fallback for (`name`, `groupID`/`categoryID`, `securityStatus`); fields the ingest already treats as optional (`published`, `position`, dogma attribute metadata) stay `.optional()`.

`localizedSchema` accepts either a bare value or a `{ [locale]: value }` map — the SDE's two shapes for localized text — where a value is a string or a number (a purely-digit name is parsed as a YAML number, not a string); `en()` (`ingest.ts`) coerces to string.

### `sdeLatestManifestSchema`
One line of `<SDE_BASE>/latest.jsonl`, the newline-delimited build-freshness manifest `fetchLatestSdeManifest` (`ingest.ts`) polls: `_key`, `buildNumber`, `releaseDate`. `.loose()` — the manifest carries entries for other keys the ingest doesn't read.

### `SdeFormatError`
Thrown by `decodeEntries` when one entry fails its schema, or when the file's top level isn't an object keyed by id. Carries `file`, `entryKey`, and `cause` (a `ZodError` or a plain message); the error message names the file, the entry, and the failing field path.

### `decodeEntries(file, data, schema): Map<number, Infer<schema>>`
Validates a `{ "<id>": entry }`-shaped SDE YAML map: rejects a non-object/array top level, coerces each key to an integer id (throwing `SdeFormatError` if it isn't one), `safeParse`s each entry against `schema`. Never throws a bare `ZodError` — every failure is wrapped with file/entry context.
