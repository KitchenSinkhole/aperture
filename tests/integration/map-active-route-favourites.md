## map-active-route-favourites.test.ts

**Purpose:** DB integration coverage for experimental active route actions, route favourites, and the route-shortcut API guard.

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```bash
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test map-active-route-favourites
```