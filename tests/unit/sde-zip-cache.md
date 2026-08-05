## sde-zip-cache.test.ts

**Purpose:** Proves `ensureSdeZip` only ever caches a complete, verified SDE download, so a truncated zip cannot become a permanent ingest failure.
**File:** `tests/unit/sde-zip-cache.test.ts`

### Setup
- No DB, no `RUN_DB_TESTS` gate — `ensureSdeZip` touches only `fetch` and the filesystem.
- `global.fetch` is stubbed per case with a synthetic `Response`-shaped object whose `body` is a `node:stream/web` `ReadableStream`.
- Runs against the real `.sde-cache/` directory under build number `999000001`, which CCP will never publish; every `sde-999000001-yaml.zip*` entry is removed before and after each case.

### Cases
- A body that errors mid-stream rejects and leaves no cache entry — neither the zip path nor a `.part` file.
- A body shorter than its declared `content-length` rejects as truncated and caches nothing.
- A complete body below the 1MB plausibility floor rejects and caches nothing.
- A complete download lands at `.sde-cache/sde-<build>-yaml.zip` at full length, and a second call serves it from disk without a second `fetch`.
- A truncated file already sitting at the cache path is discarded and re-downloaded.

### Depends On
- `@/lib/sde/ingest` (`ensureSdeZip`).
