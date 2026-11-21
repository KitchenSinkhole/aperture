## zkb-feed-persist.test.ts

**Purpose:** Drives the zKillboard live feed's `pollOnce` (`src/lib/integrations/zkbFeed.ts`) against real Postgres and checks what it writes to `universe_killmail`.
**File:** `tests/db/zkb-feed-persist.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test zkb-feed-persist
```

The feed's HTTP is a stubbed `fetch` serving the live seed and then the given entries; the active-system index, `pg_notify` and the cache writes are real. Seeds one map with one visible system, plus a system on no map, in the `9735xxxx` block.

### Covers
- The R2Z2 fixture (`tests/fixtures/zkbR2z2.ts`) for an on-map system leaves a row whose body `killmailSchema` parses, with the hash, kill time, generated `solar_system_id` and `total_value`, and that row appears in the `kills` projection.
- A kill in a system on no active map is not persisted.
- A kill whose body fails `killmailSchema` is not persisted and still flashes.
