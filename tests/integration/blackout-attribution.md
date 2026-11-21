## blackout-attribution.test.ts

**Purpose:** Blackout on attribution against real Postgres: Discord posts from the webhook dispatcher and the in-map audit route.
**File:** `tests/integration/blackout-attribution.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test blackout-attribution
```

Snapshots the live `ap_instance` Blackout switch in `beforeAll` and restores it in `afterAll`; every case starts with the switch off. Seeds ids in the `9727xxxx` block. Mocks `@/lib/auth` and `@/lib/session` to a per-test session and `fetch` to capture Discord bodies.

### Covers
- `runWebhookDispatch` — a history post names the acting character while off, and carries no character name while on.
- `GET /api/map/[mapId]/audit` — while on, a non-cleared viewer holding `audit_view` (the private map's owner) gets rows without actor fields, no actor list, no drill-down summary and `actorsHidden: true`, and neither an actor filter nor an actor-name search narrows the feed. A cleared viewer (global admin) while on, and the owner once off, get actors, the actor list and the drill-down summary.
