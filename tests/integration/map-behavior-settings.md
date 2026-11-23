## map-behavior-settings.test.ts

**Purpose:** Drives the Settings → Behavior tab's Save (`updateMapSettingsAction` in `src/app/(app)/actions/map.ts`) against real Postgres.
**File:** `tests/integration/map-behavior-settings.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test map-behavior-settings
```

Mocks `@/lib/session`'s `requireSession` (hoisted acting character) and `next/cache`. Seeds a private map, its owner, and an outsider. Ids use a 9745xxxx block.

### Covers
- A new map starts with `auto_eol_connections` off, and `loadMapSettings` reports it.
- The owner turning `autoEolConnections` on persists it to `ap_map`, records it on the stored `map.update` payload, and `loadMapSettings` pre-fills it; turning it off again is honored the same way.
- A character who cannot manage the map is refused and the flag stays off.
