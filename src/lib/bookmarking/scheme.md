## scheme.ts

**Purpose:** The single entry point for the active bookmark naming scheme — a deployment's local override when one exists, `referenceScheme` otherwise.
**File:** `src/lib/bookmarking/scheme.ts`

---

### effectiveBookmarkScheme: BookmarkScheme
`localOverride ?? referenceScheme`. `localOverride` comes from the `#bookmark-local` specifier, which resolves to a deployment's untracked `src/lib/bookmarking/local.ts` when that file is present, and to the tracked empty slot (`localNone.ts`) otherwise — so a clone without an override builds and runs against `referenceScheme`. Consumers (the Bookmarks panel) import only this export, never `reference.ts` or `local.ts` directly.

`tsconfig.json` pins `#bookmark-local` to `localNone.ts` unconditionally, so `tsc` type-checks the empty slot rather than whatever the runtime alias resolves to. An override should annotate its default export as `BookmarkScheme` (`const scheme: BookmarkScheme = { … }`) to get its own file checked against the contract.
