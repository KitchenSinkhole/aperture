## localNone.ts

**Purpose:** The tracked empty slot `#bookmark-local` resolves to when a deployment has not dropped in its own `local.ts` override.
**File:** `src/lib/bookmarking/localNone.ts`

---

### noLocalScheme (default export): `BookmarkScheme | null`
Always `null`. Typed as `BookmarkScheme | null` rather than bare `null` so the `??` fallback in `scheme.ts` type-checks as a real union narrowing, not a constant.
