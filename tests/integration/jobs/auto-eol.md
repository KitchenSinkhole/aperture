## auto-eol.test.ts

**Purpose:** Integration coverage for the `auto-eol` cron: which holes it marks `('eol', 'auto')`, the event it emits, and that the event is audited as an estimate and never posted to Discord.
**File:** `tests/integration/jobs/auto-eol.test.ts`

Gated on `RUN_DB_TESTS=1`. Scoped to two maps (one opted in via `auto_eol_connections`, one not) and `98171xxx` universe rows, removed in `afterAll`. Fake wormhole types carry a 960-minute `wormholeMaxStableTime` (resolved by name; a stand-in attribute row is inserted only when the dev DB has none). Holes are inserted directly with backdated `created_at`.

One case, asserting from the rows, the stored `ap_map_event` and `ap_job_run.notes`:
- **Marked** (`eol_at` within a minute of now, `updated_at` unchanged): an O477 + K162-bound hole 13h old; an untyped `is_static` hole whose source holds a single static leading to the target's class.
- **Untouched**: an O477 hole 11h old, a K162-only hole, a dormant (`confirmed_at` NULL) hole, an `observed`-`none` hole, an O477 hole on the non-opted map, and an untyped static whose source holds two matching statics.
- The emitted `connection.update` has no actor and carries `eolStage: 'eol'`, `eolSource: 'auto'`, `eolAt` and the endpoints; `describeMapEvent` renders it as `EOL estimated from age → ~4h`; `runWebhookDispatch` with a history webhook configured attempts nothing and never calls `fetch`.
