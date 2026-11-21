## realtime-audit-only.test.ts

**Purpose:** Proves audit-only event kinds (`AUDIT_ONLY_EVENT_KINDS`) are recorded in `ap_map_event` but never fanned out by the realtime bus.
**File:** `tests/integration/realtime-audit-only.test.ts`

Gated on `RUN_DB_TESTS=1`. Subscribes to one throwaway map through the real `LISTEN` bus.

### Covers
- `api.token_created` and `api.token_revoked` commit their rows and produce no `mapUpdate`, while an `api.disabled` committed alongside them is broadcast.
