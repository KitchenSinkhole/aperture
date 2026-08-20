## realtime-transport.test.ts

**Purpose:** End-to-end coverage of the WS + bus pipeline: `attachWsServer` wired to a real `ap_map_event` insert and Postgres `LISTEN/NOTIFY`.
**File:** `tests/integration/realtime-transport.test.ts`

### Coverage
- A map event fans to two sockets subscribed to the same map within 500ms; each delivered `mapUpdate` carries `load.mapId` and the Stage 3 envelope-level `mapId`, both equal to the source map.
- The immediate post-connect `healthCheck` frame carries no envelope-level `mapId` (control-plane frames stay unscoped).
- An upgrade with no session cookie is rejected (401).
- A soft-deleted map delivers no events to a subscriber.
- Presence: connect opens one `ap_character_presence` session; close advances `ended_at`; a reconnect within `PRESENCE_SESSION_GAP_MS` adopts the same row instead of opening a second one.

### Running
Requires containerised Postgres with migrations applied:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test realtime-transport
```
