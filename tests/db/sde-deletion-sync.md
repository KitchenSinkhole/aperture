## sde-deletion-sync.test.ts

**Purpose:** Proves `syncSdeDeletions` (`src/lib/sde/ingest.ts`) deletes SDE-derived rows absent from a build, retains rows still referenced by application data, and propagates that retention transitively through the FK chain.
**File:** `tests/db/sde-deletion-sync.test.ts`

### Running
Gated behind `RUN_DB_TESTS=1` (default `pnpm test` stays offline) and runs in the `node` vitest environment. Run in isolation — full `RUN_DB_TESTS` runs flake under parallelism, and this suite reads the ~645k-row `universe_type_attribute` table multiple times, so it is noticeably slower than most DB-gated tests.

```
docker compose up -d
pnpm db:migrate
RUN_DB_TESTS=1 pnpm test sde-deletion-sync
```

### Fixture
A synthetic region → constellation → system chain in the `98150xxx` id block, duplicated: one branch (`…001`) is referenced by an `ap_map_system` row, the other (`…002`) is unreferenced. A synthetic stargate edge connects the two systems. Every keep-set handed to `syncSdeDeletions` is built from the live tables minus this file's own synthetic ids (`liveKeepSets`), so a run can only ever delete rows this file inserted — safe against the non-pristine dev DB. `universe_category`/`universe_group`/`universe_dogma_attribute`/`universe_type`/`universe_type_attribute` keep-sets are always "everything live" (`loadBaseline`, computed once); those tables are never touched by this suite.

### Assertions
- A stargate edge absent from the keep-set is deleted with no guard (the table has no inbound FKs).
- A system referenced by `ap_map_system` is retained and counted into `report.retained.universe_system`, while its unreferenced sibling is deleted.
- Transitive retention: with the referenced system kept alive, its constellation and region are retained too (proving the guard chain, not just the immediate FK), while the unreferenced branch's constellation and region are deleted.
- `syncSdeDeletions` throws `SdeGateError` when handed an empty keep-set.
