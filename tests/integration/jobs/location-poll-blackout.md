## location-poll-blackout.test.ts

**Purpose:** Drives the location poll under Blackout against real Postgres: a tracked jump never changes the map, a jump through a confirmed `wh` hole on the map still lands in its mass log, and the `characterUpdate` breadcrumb is the same on and off.
**File:** `tests/integration/jobs/location-poll-blackout.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test location-poll-blackout
```

Holds the shared `location-poll` suite lock (`locationPollSuiteLock.ts`). Snapshots the live `ap_instance` Blackout switch in `beforeAll` and restores it in `afterAll`; every case starts with the switch on. Seeds ids in the `9725xxxx` block. Mocks `esiCall` and `getMapViewerUserIds` (the pilot's account is always viewing, so with Blackout off the fold may add systems), pins `Math.random` for job-run sampling, and LISTENs on the map channel to capture notifies.

### Covers
- While on, a jump between two visible systems joined by a confirmed `wh` writes one mass-log row and one `connectionMassLog` notify, zero `ap_map_event` rows, and `notes.blackout` instead of `notes.folds`.
- While on, a jump with an endpoint off the map, a jump through a dormant connection, and an abyssal jump (on a map tracking abyssal jumps) write nothing.
- The `characterUpdate` load (bar `locationAt`) is identical on and off.
- Once off, the same poll folds a new system onto the map.
