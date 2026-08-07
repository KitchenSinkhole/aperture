## cross-tenant-writes.test.ts

**Purpose:** Regression guard for the Stage 1 tenancy-binding asserts (`assertSystemOnMap` / `assertConnectionOnMap`, `src/lib/map/mutations/tenancy.ts`) on every create path.
**File:** `tests/integration/cross-tenant-writes.test.ts`

A pure static grep cannot guard this: the actor-authorization gate (`requireMapMutate`) is present and correct on every route, so the only reliable signal is a behavioural attempt-and-reject — build two maps and try to attach a child that lives on the other one.

### Coverage
- `createSignature` — a `mapSystemId` belonging to the other map is rejected and writes nothing; a same-map `mapSystemId` succeeds.
- `createConnection` — a `targetMapSystemId` belonging to the other map is rejected and writes nothing; both endpoints on the same map succeeds.
- `pasteSignatures` add branch — a `mapSystemId` belonging to the other map is rejected and writes nothing; a same-map `mapSystemId` succeeds.

### Running
Requires containerised Postgres with migrations applied:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test cross-tenant-writes
```
