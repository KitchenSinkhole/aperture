## blackout-read-paths.test.ts

**Purpose:** Drives the Blackout rule on every non-socket presence read path against real Postgres: the map page load, the public share payload and its snapshot cache, the viewers route and the mass-log route.
**File:** `tests/integration/blackout-read-paths.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test blackout-read-paths
```

Snapshots the live `ap_instance` Blackout switch in `beforeAll` and restores it in `afterAll`; every case starts with the switch off and an empty public snapshot cache. Seeds ids in the `9724xxxx` block. Mocks `@/lib/auth` and `@/lib/session` to a per-test session and `next/cache`; seeds the in-process `mapViewers` roster directly.

### Covers
- `loadMapForView` — while off, every pilot and an inactive `blackout` standing; while on, a non-cleared viewer's roster is their own account only and a cleared viewer's is everyone.
- `loadPublicMapView` — a `full`-presence token carries every pilot while off, and presence `none` with no field or value naming Blackout while on.
- `getPublicSnapshot` — a snapshot cached before `adminStartBlackout` / `adminEndBlackout` is not served after either.
- `GET /api/map/[mapId]/viewers` — every viewing account while off and to a cleared viewer while on; only the viewer's own characters to a non-cleared viewer while on.
- `GET …/connections/[connId]/mass-log` — `{ data: [], hidden: true }` to a non-cleared viewer while on; the full log to a cleared viewer while on and to everyone once off.
