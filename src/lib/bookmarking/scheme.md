## scheme.ts

**Purpose:** The single entry point for the active bookmark naming scheme — a deployment's local override when one exists, `referenceScheme` otherwise.
**File:** `src/lib/bookmarking/scheme.ts`

---

### effectiveBookmarkScheme: BookmarkScheme
`localOverride ?? referenceScheme`. `localOverride` comes from the `#bookmark-local` specifier, which resolves to a deployment's untracked `src/lib/bookmarking/local.ts` when that file is present, and to the tracked empty slot (`localNone.ts`) otherwise — so a clone with no override still builds and runs against `referenceScheme`. Consumers (e.g. Stage 4's panel) import only this export, never `reference.ts` or `local.ts` directly.
