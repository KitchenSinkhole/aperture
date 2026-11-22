## user-api-kills.test.ts

**Purpose:** End-to-end coverage of `GET /api/v1/kills` against real Postgres, calling the route handler directly so every request runs the whole `userApiRoute` pipeline.
**File:** `tests/integration/user-api-kills.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-kills
```

`recentKillsForSystem` (zKB client), `esiCall` (ESI client) and `fetch` are replaced with spies that throw. Pins `Date` (fake timers, Date only) to the start of a rate window and resets every in-process limiter, usage buffer, projection cache, auth cache and the instance-switch cache around each test. Snapshots the live `ap_instance` access mode and user API switch and restores them; the test corp is an instance owner. Seeds a map with two visible systems and a hidden one, a system on no map, a ship type, and cached kills at fixed offsets from the pinned clock, all in the `9736xxxx` block.

### Covers
- The default answer is the last 24 hours of kills in visible systems, newest first; a kill in a hidden or off-map system never appears; one entry is checked field by field (ids as strings, ship-type name, victim ids, attacker count, `totalValue`).
- `since` narrows; a `since` older than 7 days reads as 7 days; an unparseable one reads as the default.
- `limit` narrows; 0 and negatives read as 1; an unparseable one reads as the default; above the maximum it is capped at `USER_API_KILLS_MAX_LIMIT`, which is also the default.
- No request calls zKillboard, ESI or `fetch`.
