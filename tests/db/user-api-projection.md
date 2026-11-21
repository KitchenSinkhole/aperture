## user-api-projection.test.ts

**Purpose:** Drives the user API read projections (`src/lib/userApi/projection.ts`) and the Blackout switch's clearing of both user API caches against real Postgres.
**File:** `tests/db/user-api-projection.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-projection
```

Snapshots the live `ap_instance` Blackout switch and restores it; every case starts with the switch off and both user API caches empty. Seeds ids in the `9733xxxx` block: a map with two visible systems and one hidden, a confirmed connection, a dormant one and an orphan edge to the hidden system, a signature and intel notes in a visible and in the hidden system, one map note, a mass-log jump on each connection, and four tracked pilots on three accounts (one cleared by name). Mocks `@/lib/auth` and `next/cache` for the admin actions.

### Covers
- `map`, `signatures` and `notes` hold exactly the systems, connections, signatures and notes `loadMapForView` shows; the hidden system, the dormant connection and the orphan edge are absent, and only visible systems' intel notes appear.
- `mass_log` holds only the jump through the confirmed, visible connection, with both ends' EVE ids.
- No resource has a `userId` key at any depth; `map` has no `intelNotes` key and neither intel text.
- Blackout off: every pilot and the full mass log. On: an uncleared owner gets only their own account's pilots and `{ data: [], hidden: true }`; a cleared owner gets both in full.
- `adminStartBlackout` and `adminEndBlackout` each empty the projection cache and the auth cache (a cached entry is reloaded on the next read).
