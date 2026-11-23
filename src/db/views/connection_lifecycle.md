## connection_lifecycle.sql

**Purpose:** SQL source of the `ap_connection_lifecycle` view: one lifecycle row per dead connection, projected from the death snapshot on its `connection.delete` event.
**File:** `src/db/views/connection_lifecycle.sql`

A plain (non-materialized) view over `ap_map_event`. Its reader is operator SQL; there is no Drizzle handle and no TS reader.

---

### Source rows
`ap_map_event` where `kind = 'connection.delete'` and the payload carries `cause` (the `ConnectionDeathSnapshot` that `readConnectionDeathSnapshot` writes on every delete path). A delete event without a snapshot is not a row. Each dead connection has exactly one row: the view reads the delete event alone and never pairs it with `connection.create`, which a restore or a location-poll reconfirm re-emits for the same id.

### Shape
| Column | Type | Notes |
|---|---|---|
| `event_id` | bigint | `ap_map_event.id` of the delete. |
| `map_id` | bigint | `ap_map_event.map_id`. |
| `connection_id` | bigint | Payload `id`. |
| `scope` | text | Payload `scope`. |
| `source_map_system_id` / `target_map_system_id` | bigint | Payload `source` / `target` (`ap_map_system` ids). |
| `source_system_id` / `target_system_id` | integer | `ap_map_system.system_id` via LEFT JOIN; null when the node row is gone, never dropping the death. |
| `wormhole_code` | text | Payload `wormholeCode`: the single bound non-K162 code, `K162`, or null (untyped, disagreeing, or no bound sig, as on Thera links). |
| `is_static` | boolean | Payload `isStatic`. |
| `born_at` | timestamptz | Payload `bornAt`: the connection's `created_at`. |
| `died_at` | timestamptz | `ap_map_event.occurred_at`. |
| `lifetime_h` | double precision | `died_at - born_at`, hours. |
| `cause` | text | Payload `cause` (`ConnectionDeathCause`). |
| `last_alive_at` | timestamptz | Payload `lastAliveAt`. |
| `clear_lag_h` | double precision | `died_at - last_alive_at`, hours. True collapse lies in `[last_alive_at, died_at]`. |
| `mass_status_at_death` | text | Payload `massStatus`. |
| `was_rolled` | boolean | `cause = 'rolled'`, or `isRolling`, or `massStatus = 'critical'`: a cron-reaped hole keeps its cron cause but still reads rolled here. |
| `was_dormant` | boolean | Payload `wasDormant`: dormant (an endpoint removed) at death. |
| `eol_stage_at_death` | text | Payload `eolStage`: `none` / `eol` / `critical` / `expired`. |
| `eol_at` | timestamptz | Payload `eolAt`. |

Enum-valued fields are `text`, so an unrecognised payload value never makes the view error. No filtering by map deletion or scope: filtering is the query's job.

### Reading the numbers
- **`born_at` is "first mapped on this map", not spawn**, so it is an upper bound on the spawn time and `lifetime_h` a lower bound. Map import and Thera sync stamp `created_at` at import/sync time, so their lifetimes read short.
- **Dormant at death:** dormanting clears `confirmed_at` (and any scan heartbeat with it) without touching `updated_at`, so a `was_dormant` row's `last_alive_at` comes from the mass log and the last edit only. Its `clear_lag_h` is an upper bound inflated by the off-map gap.
- **Dormant-then-restored** holes are one row, with lifetime continuous across the off-map gap. A restore re-stamps `confirmed_at`, so `last_alive_at` reflects it. `was_dormant` reports dormancy at death only; mid-life dormancy is not modelled.

### Applied by
`src/db/migrations/0075_connection_lifecycle_view.sql` creates it; its hand-run `.rollback.sql` drops it.
