## schema.ts

**Purpose:** Zod boundary validator for the user-supplied map dashboard layout JSON before it lands in `ap_user.map_layout`.
**File:** `src/lib/map/layout/schema.ts`

---

### mapLayoutConfigSchema
Zod schema for a stored map layout. Validates `version` (int 0..1_000_000), `layouts` (an object with `lg`/`md`/`sm` keys, each an array of ≤50 layout items), `groups` (**optional** — an object with `lg`/`md`/`sm` keys, each an array of ≤50 panel groups), and `hidden` (an array of ≤50 `PanelId`s). Each layout item is `{ i: PanelId; x; y; w; h; minW?; minH? }` with bounded integer coordinates (`x`/`y` 0..1000) and spans (`w`/`h` 1..1000). Each panel group is `{ id: string(1..100); members: PanelId[](1..50); active: PanelId }`, refined so `members` are unique and `active` is one of `members`. Each breakpoint's group array is refined so a panel belongs to at most one group. `i` and member/active ids are constrained to the `PanelId` enum (derived from `PANELS`). Unknown item keys (RGL's `static`, `moved`, `maxW`, …) are stripped — only the minimal geometry is persisted. `groups` is optional so a pre-v2 file still parses; callers run `migrateLayout` to fill singleton groups after this boundary. Used by `setMapLayoutAction` (`actions/account.ts`) and the client import path via `safeParse`.

### ParsedMapLayout (type)
`z.infer<typeof mapLayoutConfigSchema>` (`groups` optional). A module-level conditional-type assertion guarantees it is assignable to `StoredMapLayout` (`src/types/index.ts`).
