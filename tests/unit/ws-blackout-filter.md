## ws-blackout-filter.test.ts

**Purpose:** Unit tests for the pure Blackout filters on the WS server's egress, `filterSessionMessage`, `publicActionFor` and `publicNudgeOnBlackoutFlip` (`src/lib/realtime/wsServer.ts`).
**File:** `tests/unit/ws-blackout-filter.test.ts`

### Covers
- `filterSessionMessage` — off (cleared or not) and on-and-cleared pass every message unchanged: own / other `characterUpdate`, own / other / mixed `characterLogout`, own / other `connectionMassLog`, `mapUpdate`, `systemNotification`. On and not cleared: passes the viewer's own account's `characterUpdate` and drops another account's; passes a `characterLogout` naming only own characters, drops one naming only others (or any while the own set is empty), and narrows a mixed one to the own ids; drops every `connectionMassLog`; passes `mapUpdate` and `systemNotification` unchanged.
- `publicActionFor` — `mapUpdate` nudges with Blackout on or off; `characterUpdate` / `characterLogout` nudge for a `full` or `anonymous` share only while off, and never for a `none` share; `mapDeleted` closes; `connectionMassLog`, `systemNotification` and `healthCheck` are dropped.
- `publicNudgeOnBlackoutFlip` — a `full` or `anonymous` share is nudged when the switch turns on or off; nothing is nudged when the switch reads unchanged, and a `none` share never is.
