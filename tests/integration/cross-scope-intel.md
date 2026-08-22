## cross-scope-intel.test.ts

**Purpose:** Regression guard for the intel-scoping invariants on `ap_structure` — a row is readable and mutable only by characters its `scope` triple admits, and a new row takes its scope from a map the writer can view.
**File:** `tests/integration/cross-scope-intel.test.ts`

A pure static grep cannot guard this: the session gate is present on every structure route, and `ap_structure` carries no `map_id`, so nothing in a route file's text distinguishes a scoped read from a deployment-global one. The only reliable signal is behavioural — stand up two organisations and have each try to read and mutate the other's rows.

### Units under test
`intelScopeForMap`, `requireStructureMutate`, `scopeAdmits`, `structureVisibleTo`, `resolveIntelViewer` (`src/lib/structures/guard.ts`); `structuresForSystems` (`src/lib/structures/read.ts`); the three mutation helpers. Local `createAsRoute` / `patchAsRoute` / `deleteAsRoute` helpers mirror each route's guard-then-mutate order, so removing a guard fails the assertion on both the status and the row state.

### Fixtures
Universe ids `98047xxx`; org / character ids `99060xxx`. Two organisations (corp + alliance each), an org-A corp mate, a global admin, a `kicked` character and an id that was never inserted. Six maps: org A's corp / alliance / private, org B's corp, an unowned corp map, and a soft-deleted one. Five structures spanning all three scope tiers plus the erased-owner row (`scope='private'` with `scope_character_id` NULL), which is inserted directly because no write path can produce it.

### Coverage
- `intelScopeForMap` — derives one populated `scope_*` column per map type; returns `null` for an unowned map, a soft-deleted map and a missing id. An admin clears `requireMapView` on the first two, so that `null` is the only thing preventing a fabricated tenancy.
- Create — a `mapId` the caller cannot view is rejected; an admitted map stamps its scope onto both the row and the `ap_structure_event` create row.
- Create, accepted behaviour — the body's `systemId` need not be on the scope-selector map. Pinned deliberately: the row lands in a scope the caller could reach anyway, so it is not a cross-tenant capability.
- `requireStructureMutate` — admits across all three tiers including a corp mate who did not write the row; answers 404 (never 403) outside the scope, for a missing row, for a `kicked` or absent character; 401 with no session; admits only an admin to the erased-owner row.
- Cross-scope PATCH / DELETE — 404 and the row, its columns and its audit trail are untouched. Same-scope create → patch-by-a-corp-mate → delete succeeds and writes three scope-stamped audit rows.
- `structuresForSystems` — returns exactly the rows the viewer's scope admits, surfaces `scope` / `scopeEntityId` for the UI, reads `{}` for a missing or non-active character, and hides the erased-owner row from everyone but an admin.
- The `system-data` sweep — 256 system ids as org B returns none of org A's rows.
- `scopeAdmits` / `structureVisibleTo` agreement over the fixture set, asserted as `viewer.isAdmin || scopeAdmits(row, viewer)`. `scopeAdmits` carries no admin branch by design — both callers short-circuit on admin before reaching it — so a raw row-for-row comparison would diverge for an admin viewer, and adding admin to `scopeAdmits` to close that gap would widen the write gate.

### The `ap_system_note` block
A second describe mirrors the structure block for global system notes (recreating the same org shapes after the first block's cleanup): map-derived scope stamped on row + create event, row-scoped mutate gate (404 outside the scope, before the lock's 409), cross-scope PATCH/DELETE leave rows and audit untouched, guest tenancy refusal on read and create, same-scope CRUD, and the two browser assertions — a category-chip search hit stays scope-filtered, and a **capped** page contains only admitted rows (org B floods past `NOTE_SEARCH_LIMIT`, org A's buried matches must all surface: the viewer filter runs before the cap). `pool.end()` lives in a file-level `afterAll` so both blocks share the connection pool.

### Running
Requires containerised Postgres with migrations applied:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test cross-scope-intel
```
