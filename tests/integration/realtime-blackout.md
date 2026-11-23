## realtime-blackout.test.ts

**Purpose:** Blackout over the real WS + bus pipeline: `attachWsServer` against a real instance-channel `pg_notify` and map-channel `characterUpdate` broadcasts, with session sockets and two public spectator sockets (a `full` and a `none` share on the same map).
**File:** `tests/integration/realtime-blackout.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Snapshots the live `ap_instance` Blackout switch in `beforeAll` and restores it in `afterAll`. Seeds ids in the `9723xxxx` block.

### Covers
- The first `healthCheck` after connect that carries `blackout` reports the socket's standing (`{ active: false, since: null, cleared: false }` while off).
- Turning the switch on plus an instance notify sends every session socket an immediate `healthCheck` with `active: true`, the start time and its own `cleared`, and the `full` share's public socket one data-free `publicUpdate`; the `none` share's socket receives nothing.
- While on, a non-cleared socket subscribed to a map receives its own account's `characterUpdate` and not another account's.
- Adding a `blackout_view` grant plus an instance notify re-resolves each socket separately (the granted account reads `cleared: true`, the other `false`), and the granted socket then receives the other account's `characterUpdate`.
- Lifting the switch plus a notify reports `active: false` to every socket and nudges the `full` share's public socket once more (the `none` share's still receives nothing).

### Running
```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test realtime-blackout
```
