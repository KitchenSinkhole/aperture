## connection-lifecycle-view.test.ts

**Purpose:** Integration coverage for the `ap_connection_lifecycle` view, read back over `connection.delete` events written by the real delete paths.
**File:** `tests/integration/connection-lifecycle-view.test.ts`

Gated on `RUN_DB_TESTS=1`. Scoped to its own map (opted into EOL reaping) and `98175xxx` universe rows, removed in `afterAll`. Timings are read as epoch milliseconds in the query, and each `lifetime_h` / `clear_lag_h` is checked both against `died_at` minus its anchor and against the backdated stamps.

Cases:
1. **manual_removed**: a user delete of a K162-bound hole aged 3h with a jump 1h ago is one row with `wormhole_code: 'K162'`, both universe endpoints, `lifetime_h` ≈ 3, `clear_lag_h` ≈ 1, `eol_source` null.
2. **rolled**: an `is_rolling` hole deleted as `manual_removed` is one `rolled` row with `was_rolled`.
3. **sig_orphaned**: an empty bulk paste dropping the hole's only O477 sig is one `sig_orphaned` row with `wormhole_code: 'O477'`.
4. **eol_reaped**: `eolExpiry` reaping a mid-roll O477 hole born 20h ago, last jumped 2h ago, is one `eol_reaped` row with `was_rolled`, `eol_source: 'observed'`, `lifetime_h` ≈ 20, `clear_lag_h` ≈ 2.
5. **auto EOL reaped**: `eolExpiry` reaping a hole hand-set to `('eol', 'auto')` is one `eol_reaped` row with `eol_source: 'auto'`.
6. **human EOL**: an `updateConnection` to `eol`, then a delete, is one row with `eol_source: 'observed'`.
7. **snapshot without `eolSource`**: a hand-inserted Stage-1-shape snapshot at `eolStage: 'eol'` reads `eol_source: 'observed'`.
8. **dormant then restored**: `removeSystem` on an endpoint, a hand-set `('eol', 'auto')`, `restoreConnection` (whose re-broadcast `connection.create` carries `eolSource: 'auto'`), then a delete is exactly one row.
9. **pre-snapshot event**: a hand-inserted `connection.delete` with `{ id, source, target }` only is absent from the view.
