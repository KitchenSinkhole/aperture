## map-api-routes.test.ts

**Purpose:** Integration coverage for signature CRUD helpers, `guardMap`/`parseBigInt` guards, and LISTEN-based broadcast confirmation.
**File:** `tests/integration/map-api-routes.test.ts`

### Coverage
- `parseBigInt` — valid positive integers, zero, negatives, non-numeric strings.
- `guardMap` — live map, soft-deleted map, unknown id.
- `createSignature` — row insert, exactly one `signature.create` event, payload parses.
- `updateSignature` — partial patch, only patched fields echoed, cross-map ownership rejection.
- `deleteSignature` — hard delete, exactly one `signature.delete` event.
- LISTEN broadcast — `createSignature`, `createConnection`, `removeSystem` each fire `pg_notify('map:<mapId>')` within 2 s.

### Running
Requires containerised Postgres with migrations applied:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
```
