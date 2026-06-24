## universe-ingest.test.ts

**Purpose:** Proves static-data parity against the pinned SDE build after `pnpm sde:bootstrap`.
**File:** `tests/db/universe-ingest.test.ts`

### Running
Gated behind `RUN_DB_TESTS=1` (default `pnpm test` stays offline) and runs in the `node` vitest environment. Requires a migrated, bootstrapped Postgres:

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
pnpm db:migrate
pnpm sde:bootstrap
RUN_DB_TESTS=1 pnpm test
```

### Assertions
- **Lower-bound counts** for the pinned build (regions ≥110, constellations ≥1100, systems ≥8200, types ≥40000, type_attributes ≥500k, stargate edges ≥13000, overrides ≥60).
- **Referential self-consistency:** no orphaned stargate-edge endpoints; no orphaned type_attribute type ids.
- **Fixture spot-check:** Jita (30000142 → `H`), Perimeter, Thera (`C…`), J105443 (`C1`), a Pochven system (`P`), an Abyssal system (`A`).
- **100-system sample:** names present; first 100 (k-space) ids each have ≥1 neighbour.
- **Route lookup:** Jita↔Perimeter adjacency present both directions; 5-hop BFS over `universe_stargate_edge` reaches >50 systems.
- **Trade-hub proximity** (`computeHubProximity` output on `universe_system`): Perimeter → Jita at 1 jump; hub systems (distance 0) and non-HS systems are unbadged; every assigned row uses a valid hub id with `1 ≤ jumps ≤ hub.proximityJumps`; and Jita-assigned distances exactly match an HS-only recursive-CTE BFS from Jita (proving the route stays in high-sec end-to-end).
- **Effective view:** WH A239 (type 30678) attr 3974 resolves to the CSV override value (5).
- **WH catalog vocabulary:** Thera (31000005) derives to `C12`, F135's `target_class` equals it, and no `universe_wormhole` row uses the literal `Thera` token in `target_class`/`source_classes` (catalog labels share `universe_system.security`'s vocabulary).
