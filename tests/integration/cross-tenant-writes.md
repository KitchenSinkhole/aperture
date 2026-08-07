## cross-tenant-writes.test.ts

**Purpose:** Regression guard for the tenancy-binding asserts (`assertSystemOnMap` / `assertConnectionOnMap`, `src/lib/map/mutations/tenancy.ts`) on every path that takes a child id from the request body.
**File:** `tests/integration/cross-tenant-writes.test.ts`

A pure static grep cannot guard this: the actor-authorization gate (`requireMapMutate`) is present and correct on every route, so the only reliable signal is a behavioural attempt-and-reject — build two maps and try to attach a child that lives on the other one.

### Coverage
- `createSignature` — a `mapSystemId` belonging to the other map is rejected and writes nothing; a same-map `mapSystemId` succeeds.
- `createConnection` — a `targetMapSystemId` belonging to the other map is rejected and writes nothing; both endpoints on the same map succeeds.
- `updateSignature` — a patch naming a `mapConnectionId` on the other map is rejected, writes nothing, and leaves the sig's link null.
- `pasteSignatures` add branch — a `mapSystemId` belonging to the other map is rejected and writes nothing; a same-map `mapSystemId` succeeds.
- `pasteSignatures` short-circuit branch — a foreign `mapSystemId` is rejected even when every incoming row hits `continue` (`updateExisting` off, code already present), the case where no per-sig helper runs and so nothing downstream can throw. An ok/reject split here would be an existence oracle for signature codes on any system of any map.

### Running
Requires containerised Postgres with migrations applied:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test cross-tenant-writes
```
