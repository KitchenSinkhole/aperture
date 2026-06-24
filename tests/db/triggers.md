## triggers.test.ts

**Purpose:** Proves the `ap_map_event` AFTER INSERT trigger fires `pg_notify('map:'||map_id, payload)` on every insert, the sole hook the realtime layer depends on.
**File:** `tests/db/triggers.test.ts`

### Running
Gated behind `RUN_DB_TESTS=1` (default `pnpm test` stays offline), runs in the `node` vitest environment. Requires a migrated Postgres:

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
pnpm db:migrate
RUN_DB_TESTS=1 pnpm test
```

### Setup
Applies migrations, inserts one `ap_map`, opens a second raw `pg.Client` and `LISTEN "map:<mapId>"`.

### Assertions
- Inserting an `ap_map_event` with a payload delivers a notification on `map:<mapId>` whose payload JSON round-trips (`{ systemId: 30000142 }`).
- A null-payload insert delivers `'{}'` (the `COALESCE` fallback in `fn_map_event_notify`).
