## connection-death-snapshot.test.ts

**Purpose:** Integration coverage for the `connection.delete` death snapshot on the manual delete path, asserted against the stored `ap_map_event.payload` so a field the zod schema strips fails the test.
**File:** `tests/integration/connection-death-snapshot.test.ts`

Gated on `RUN_DB_TESTS=1`. Scoped to its own map and `98161xxx` universe rows, removed in `afterAll`. Each connection has its own stamps backdated 3h and a mass-log jump 1h ago, so `lastAliveAt` must come from the log.

Cases:
1. **manual_removed**: a user delete of a hole bound to an O477 sig and a K162 sig records `cause: 'manual_removed'`, `bornAt` = `created_at`, `lastAliveAt` no earlier than the jump, the full flag set, and `wormholeCode: 'O477'`.
2. **rolled**: deletes of an `is_rolling` hole and a `mass_status = 'critical'` hole, both requested as `manual_removed`, record `cause: 'rolled'`.
3. **wasDormant**: a hole with `confirmed_at` NULLed records `wasDormant: true`.
4. **sig_orphaned**: an empty bulk paste with `removeMissing` + `removeOrphanedConnections` drops the hole's only bound sig (O477); the delete records `cause: 'sig_orphaned'`, `bornAt`, `lastAliveAt` no earlier than the jump, and keeps `wormholeCode: 'O477'` although that sig is deleted first.
5. **scan heartbeat**: re-pasting two bound sigs advances the live hole's `confirmed_at` past its logged jump and leaves a dormant hole's NULL; the live hole's later delete records that heartbeat as `lastAliveAt`.
6. **code rule**: `boundWormholeCodeSql` evaluated over literal code lists: a single non-K162 code wins over a far-end K162 (and over its own duplicate); K162 alone yields `K162`; no codes, or two disagreeing non-K162 codes (with or without a K162), yield null.
