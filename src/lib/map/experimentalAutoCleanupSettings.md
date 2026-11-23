## experimentalAutoCleanupSettings.ts

**Purpose:** Parse and merge per-map experimental automatic cleanup toggles in `ap_map.next_bookmarks`.
**File:** `src/lib/map/experimentalAutoCleanupSettings.ts`

---

### parseExperimentalAutoCleanupFromNextBookmarks(raw: unknown): ExperimentalAutoCleanupSettings
Returns `autoSignatureCleanup` and `autoMapCleanup`, each defaulting to `false` when absent or when `next_bookmarks` is a legacy bookmark array.

---

### mergeExperimentalAutoCleanupIntoNextBookmarks(raw: unknown, patch: Partial<ExperimentalAutoCleanupSettings>): unknown
Writes `experimentalAutoCleanup.signatureCleanup` / `mapCleanup` on the jsonb blob while preserving unrelated keys (or wrapping a legacy array as `{ bookmarks: [...] }`).