# Wormhole Lifetime Instrumentation

**Goal:** Capture enough at connection death that wormhole lifetime can be measured (natural vs rolled, collapse time vs clear time) with a single query, instead of being forensically reconstructed from raw events.

**References:** CLAUDE.md — history lives in `ap_map_event` (no parallel audit table), exactly one `INSERT INTO ap_map_event` per mutation, shared domain types go in `src/types/index.ts`, hard-delete for `ap_map_connection`.
- `src/db/schema/ap/map_connection.md` (`eol_stage`, `eol_at`, `confirmed_at`, `mass_status`, `is_rolling`, `created_at`)
- `src/db/schema/ap/map_connection_log.md` (per-jump alive-pings; **ON DELETE CASCADE** with the connection)
- `src/lib/map/mutations/core.md` (`commitMapEvent`)
- `aperture.config.ts` (`WORMHOLE_DEFAULT_LIFETIME_MS`, `WORMHOLE_EOL_LIFETIME_MS`, `WORMHOLE_EOL_CRITICAL_LIFETIME_MS`, `WORMHOLE_EXPIRED_LIFETIME_MS`)

---

## The measurement problem this fixes

The J160941 static study could only report lifetime as "time until a human cleared the hole." Two error sources fell out of that:

1. **Clear-lag.** A hole collapses in-game at T and is cleared at T+lag. Observed lifetime overcounts by the lag. This produced the only apparent over-runs (O477 to 17.4h, B274 to 26.2h), which are really "nobody deleted it yet," not "it stayed open."
2. **Stale abandonment.** 56 home holes were never EOL-flagged and rotted until the blind 48h `expiredConnections` cap swept them. At 48h they are physically impossible lifetimes, so they carry no lifetime signal at all, yet they had to be filtered out by hand.

On top of that, most young deaths are **rolled** holes (deliberate mass-collapse), which are not a lifetime signal but currently look identical to natural collapse in the event log.

**The binding constraint:** on collapse the connection row and its mass-log both vanish (cascade). So `ap_map_event` is the sole durable record. Every fact below must be written into the `connection.delete` event *at delete time*, read from the connection and its log inside the deleting transaction. Nothing can be recovered afterward.

### Signals already collected today

| Signal | Where it lives | Survives collapse? |
|---|---|---|
| Birth time | `ap_map_connection.created_at`, and the `connection.create` event | Event: yes |
| Last tracked jump ("alive at T") | `ap_map_connection_log.jumped_at` | **No, cascades away** |
| Last sig re-observation | `ap_map_connection.confirmed_at` | **No** |
| Dormant (endpoint system removed) | `ap_map_connection.confirmed_at IS NULL` | **No** |
| Mass state / rolled | `ap_map_connection.mass_status`, `is_rolling` | **No** |
| EOL stage + when entered | `ap_map_connection.eol_stage`, `eol_at` | **No** |
| Wormhole type code | `ap_map_signature.type_id` on the sig(s) bound via `map_connection_id` → `universe_wormhole.name` | **No, bound sigs cascade away** |
| Home-static designation | `ap_map_connection.is_static` | **No** |
| Endpoint systems | already in the `connection.delete` payload | Yes |

Everything in the "No" rows is what Stages 1 and 2 rescue into the delete event.

### The three delete sites

There are exactly three emitters of `connection.delete` in the codebase:

| Site | Trigger |
|---|---|
| `deleteConnection` (`src/lib/map/mutations/connections.ts`) | user delete via the API route, the subchain batch helpers, and the bulk-paste orphan sweep |
| `eolExpiry` cron | `eol_stage <> 'none'` past its per-stage clock, on opt-in maps |
| `expiredConnections` cron | `scope = 'wh'` older than the blind 48h cap, on opt-in maps |

`removeSystem` is **not** one of them: removing a system dormants its incident `wh` links (`confirmed_at = NULL`, kept as restorable memory) rather than deleting them. A dormant hole that is never restored dies later under the 48h sweep, so "abandoned via endpoint removal" is only distinguishable if dormancy rides the death snapshot.

---

## Stage 1 — Typed cause + death snapshot on the manual delete path
**Mode:** Execute
**Status:** done — d69f292c
**Goal:** Give `deleteConnection` a required typed cause and a death snapshot read inside the deleting transaction, so a manually-cleared hole records why it died and what state it died in.
**References:** `src/lib/map/mutations/connections.md`, `src/lib/map/mutations/core.md`, `src/lib/map/mutations/subchain.md`, `src/lib/map/mutations/bulkSignatures.md`, `src/app/api/map/[mapId]/connections/[connId]/route.md`, `src/db/schema/ap/map_connection.md`, `src/db/schema/ap/map_connection_log.md`, `src/types/index.md`
**Touches:** `src/types/index.ts`, a new death-snapshot reader under `src/lib/map/`, `src/lib/map/mutations/connections.ts`, and the three `deleteConnection` callers (`src/app/api/map/[mapId]/connections/[connId]/route.ts`, `src/lib/map/mutations/subchain.ts`, `src/lib/map/mutations/bulkSignatures.ts`), and the `connection.delete` member of `mapEventPayloadSchema` in `src/lib/realtime/protocol.ts`. Their companion `.md` files. No schema migration (payload is jsonb; `event_kind` is unchanged).

**`protocol.ts` is load-bearing:** `commitMapEvent` stores `mapEventPayloadSchema.parse(...)`, and zod strips unknown keys. Snapshot fields missing from the `connection.delete` schema are silently dropped before the INSERT. Declare them `.optional()` there: the two crons emit `connection.delete` without a snapshot until Stage 2 lands, and historical events have none. `deleteConnection`'s required cause parameter is what makes the snapshot mandatory on this path, not the zod schema.

**Settled design:**
- **Cause union** (`ConnectionDeathCause` in `src/types/index.ts`), one per delete site, no default:
  - `manual_removed` — a user deleted it (API route, subchain batch).
  - `rolled` — deleted while `is_rolling` is set or `mass_status` is critical. Derived inside the snapshot read, and takes precedence over `manual_removed`.
  - `sig_orphaned` — the bulk-paste orphan sweep removed it because its signature is gone from a fresh scan. **This is the strongest natural-collapse evidence in the system**: a scanner looked and the hole was not there. It must not be folded into `manual_removed`.
  - `eol_reaped` — the `eolExpiry` cron (Stage 2).
  - `expired_swept` — the `expiredConnections` 48h cap (Stage 2).
- **Death snapshot fields** on the payload: `bornAt` (`created_at`), `lastAliveAt`, `scope`, `massStatus`, `isRolling`, `isStatic`, `eolStage`, `eolAt`, `wasDormant` (`confirmed_at IS NULL` at death), `wormholeCode`.
- **`wormholeCode` derivation:** read from the `ap_map_signature` rows bound to the connection (`map_connection_id`), joined to `universe_wormhole` on `type_id`, inside the deleting transaction because bound sigs cascade with the connection. Exactly one distinct non-K162 code bound → that code. Only K162 bound → `K162`. No typed sig bound, or bound sigs disagreeing on a non-K162 code → `null`. Stage 4's read model takes the type from this field only (see its notes for why the event-history sig join is unsound).
- **`lastAliveAt` derivation:** `greatest(max(ap_map_connection_log.jumped_at), confirmed_at, updated_at)`, read in the same transaction as the delete because the log cascades. It is a lower bound on "known open at" — untracked jumps and scanner sightings do not ping it (Stage 3 widens it). True collapse lies in `[lastAliveAt, deletedAt]`.
- The snapshot reader is shared, so Stage 2's crons reuse it rather than growing a second derivation.

**Done when:** `deleteConnection` requires a cause, its payload carries the full snapshot, and an integration test asserts a plain user delete tags `manual_removed`, a connection with `is_rolling` set tags `rolled`, and a bulk paste dropping a mapped sig tags `sig_orphaned` — each with `bornAt` and a `lastAliveAt` no earlier than a logged jump on that connection — and a connection with a bound typed signature carries its `wormholeCode`. The assertions read the stored `ap_map_event.payload`, not the value `deleteConnection` returns, so a field the zod schema strips fails the test. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

---

## Stage 2 — Death snapshot on the two reaper crons
**Mode:** Execute
**Status:** done — a3d08609
**Goal:** Make both cron reapers emit the same cause-plus-snapshot payload as the manual path, so no death escapes the instrumentation.
**References:** `src/lib/jobs/tasks/eolExpiry.md`, `src/lib/jobs/tasks/expiredConnections.md`, `src/lib/map/mutations/core.md`, `src/lib/map/connectionDeathSnapshot.md` (Stage 1's snapshot reader)
**Touches:** `src/lib/jobs/tasks/eolExpiry.ts`, `src/lib/jobs/tasks/expiredConnections.ts`, their companion `.md` files, and the job integration tests.

**Constraint:** both reapers currently delete-with-`RETURNING` the endpoint ids only. The snapshot (including the mass-log max) must be captured in the same transaction as the delete — a pre-select inside the `commitMapEvent` `mutate` or a CTE, not a separate read before it.

**What Stage 1 shipped for this:** `readConnectionDeathSnapshot(tx, { connectionId, mapId, cause })` in `src/lib/map/connectionDeathSnapshot.ts` is runner-safe (no `server-only`), already accepts `eol_reaped` / `expired_swept`, and is per-connection, which fits both reapers' existing one-`commitMapEvent`-per-row loop: call it first inside `mutate`, then delete, then spread it into the payload as `deleteConnection` does. It locks the row `FOR UPDATE` and returns `null` when the row is gone (a concurrent delete since the candidate select), which the reaper should treat like its current "already gone" throw. The `rolled` promotion applies only to a requested `manual_removed`, so a cron-reaped hole keeps its cron cause and reports roll state through `isRolling` / `massStatus` alone. The `connection.delete` zod member already declares every snapshot field; no `protocol.ts` change is needed.

**Done when:** an `eolExpiry` sweep emits `eol_reaped` and an `expiredConnections` sweep emits `expired_swept`, both with the full snapshot; a swept connection that was dormant carries `wasDormant: true`; DB integration tests cover both sweeps. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

---

## Stage 3 — Scan re-observation heartbeat
**Mode:** Execute
**Status:** done — 751d42b5
**Goal:** Bump `confirmed_at` every time a probe-scan paste re-lists a mapped connection's signature, so holes nobody jumps but scanners keep seeing still get a fresh "known open at" stamp, tightening the clear-lag bound.
**References:** `src/lib/map/mutations/bulkSignatures.md`, `src/lib/map/mutations/signatures.md`, `src/db/schema/ap/map_connection.md`
**Touches:** `src/lib/map/mutations/bulkSignatures.ts` (and `signatures.ts` if the single-sig update path shares the gap), their companion `.md` files, tests.

**Established gap:** `confirmed_at` is stamped on create (explicitly by `createConnection`, by column default elsewhere), re-stamped by `restoreConnection` and by the location-poll auto-link, and NULLed by `removeSystem`. **No paste path touches it** — so a hole that is scanned every hour for a day looks, at death, exactly as stale as one nobody has looked at since it was mapped. Closing this is what makes `lastAliveAt` meaningful for holes without tracked jumps.

**Done when:** re-pasting a scan that still lists a mapped connection's signature advances that connection's `confirmed_at`, covered by a test; the advanced value flows into Stage 1's `lastAliveAt` derivation without further change.

---

## Stage 4 — Connection-lifecycle read model
**Mode:** Execute
**Status:** done — 2d2a4742
**Goal:** Ship `ap_connection_lifecycle`, a plain SQL view that projects every instrumented `connection.delete` event into one lifecycle row per dead connection, replacing the session-local `home_wh_life` / `conn_static` temp views the original study hand-rolled.
**References:** `src/db/views/activity_rollup.md` (the SQL-source-file + custom-migration precedent for a view over `ap_map_event`), `src/db/schema/ap/map_event.md`, `src/db/schema/ap/map_system.md`, `src/lib/map/connectionDeathSnapshot.md` (Stage 1's snapshot reader), `src/lib/realtime/protocol.md` (`connection.delete` payload), `src/types/index.md` (`ConnectionDeathCause`)
**Touches:** `src/db/views/connection_lifecycle.sql` + `src/db/views/connection_lifecycle.md` (source of truth + companion), a custom migration at the next free number (`src/db/migrations/00NN_connection_lifecycle_view.sql`, generated with `drizzle-kit generate --custom` so the journal records it) + its hand-written `.rollback.sql`, and one DB integration test. No Drizzle handle and no TS reader: the consumer is operator SQL. Add a `pgView(...).existing()` handle only if a TS reader appears.

**Settled design:**
- **Plain view, not materialized.** The only reader is an analyst running occasional queries, so a seq scan over the `connection.delete` events is acceptable. A materialized form would need a refresh job and a stale window, and nothing needs that speed. No new table, no dual-write.
- **Source rows:** `ap_map_event` where `kind = 'connection.delete'` **and** the payload carries the snapshot (`payload ? 'cause'`). Pre-Stage-1 deletes are **excluded outright**. They have no cause, no last-alive and no death state, and backfilling them by pairing with create events is the forensic reconstruction this plan exists to retire.
- **No create-event pairing.** The snapshot's `bornAt` is the row's `created_at`. `restoreConnection` and the location-poll reconfirm both re-emit `connection.create` with the same id and the same `createdAt`, so a create join would fan out per re-confirm. The view reads the delete event alone, which gives exactly one row per connection id.
- **Dormant at death:** `removeSystem` NULLs `confirmed_at` without touching `updated_at`, so a hole that died dormant has lost its last confirmation (and, after Stage 3, its scan heartbeat): its `last_alive_at` comes from the mass log and `updated_at` alone. The view companion states this, so `clear_lag_h` on `was_dormant` rows is read as an upper bound inflated by the off-map gap.
- **Dormant-then-restored:** one row, with lifetime continuous across the off-map gap, because the hole existed in-game whether or not it was drawn. A restore re-stamps `confirmed_at`, so `last_alive_at` already reflects it. `was_dormant` reports dormancy at death only. Mid-life dormancy intervals are not modelled.
- **Endpoints:** the payload's `source`/`target` are `ap_map_system` ids. LEFT JOIN `ap_map_system` for the universe `system_id`, so a missing system row never drops a death.
- **`born_at` means "first mapped on this map", not spawn.** It is an upper bound on the spawn time. Map import and Thera sync stamp `created_at` at import/sync time, so their lifetimes read short. This is **documented in the view companion, not instrumented** (decided in the design pass). Thera holes bind no signature, so their `wormhole_code` is `NULL` and per-type queries skip them anyway.
- Enum-valued payload fields surface as `text`, not cast to PG enums, so an unrecognised value never makes the view error. Maps are not filtered by `deleted_at`, and rows are not filtered by `scope`: filtering is the query's job.

**Columns:**

| Column | Source |
|---|---|
| `event_id` | `ap_map_event.id` |
| `map_id` | `ap_map_event.map_id` |
| `connection_id` | payload `id` → bigint |
| `scope` | payload `scope` |
| `source_map_system_id` / `target_map_system_id` | payload `source` / `target` → bigint |
| `source_system_id` / `target_system_id` | `ap_map_system.system_id` via the LEFT JOIN |
| `wormhole_code` | payload `wormholeCode` |
| `is_static` | payload `isStatic` |
| `born_at` | payload `bornAt` → timestamptz |
| `died_at` | `ap_map_event.occurred_at` |
| `lifetime_h` | `died_at - born_at` in hours |
| `cause` | payload `cause` |
| `last_alive_at` | payload `lastAliveAt` → timestamptz |
| `clear_lag_h` | `died_at - last_alive_at` in hours (true collapse lies in `[last_alive_at, died_at]`) |
| `mass_status_at_death` | payload `massStatus` |
| `was_rolled` | `cause = 'rolled' OR isRolling OR massStatus = 'critical'` (a cron can reap a hole that was mid-roll; the mass-critical arm is Stage 1's own `rolled` rule, which only promotes `manual_removed`) |
| `was_dormant` | payload `wasDormant` |
| `eol_stage_at_death` | payload `eolStage` (all four values) |
| `eol_at` | payload `eolAt` → timestamptz |

**Done when:** the migration applies on the dev DB and its `.rollback.sql` drops the view cleanly. A `RUN_DB_TESTS` integration test, scoped to its own map and cleaning up after itself (the suite hits the live dev DB), asserts that:
- connections deleted with each of `manual_removed`, `rolled` and `sig_orphaned`, plus one reaped by a cron, each yield exactly one row with the expected `cause`, `born_at`, `lifetime_h`, `clear_lag_h`, `was_rolled` and `wormhole_code`;
- a connection dormanted by `removeSystem`, restored, then deleted yields exactly one row;
- a hand-inserted `connection.delete` event with a pre-Stage-1 payload (`{ id, source, target }` only) is absent from the view.

`pnpm lint`, `pnpm typecheck`, `pnpm build` green.

---

## Stage 5 — Age-based auto-EOL marking (overview)

**Goal:** Mark a wormhole `eol_stage = 'eol'` automatically as it approaches its type's catalogued lifetime, so abandoned holes get reaped by `eolExpiry` near nominal instead of rotting to the 48h `expiredConnections` cap. This is what kills the stale pile at the source.

**The design risk that gates it:** an age-based EOL is a *guess* about collapse, not an observation. It must be distinguishable from a scout's EOL everywhere it is read (DB, wire, death snapshot, read model, map, Discord, user API), or guesses get laundered into the dataset as data, which is the exact failure this effort exists to prevent.

Split into seven sub-stages, 5a–5g. **The feature stays inert until 5g:** the per-map flag defaults off and its toggle ships last, so no map can opt in before the map can tell an estimate from an observation.

**Settled design (applies across 5a–5g):**
- **`eol_source` is the provenance of the current `eol_stage` value.** New `pgEnum` `eol_source` = `auto` | `observed`, nullable column `ap_map_connection.eol_source`. `NULL` means nobody has ever set the stage (the `none` default). `observed` means a human set it last, **including setting it to `none`**. `auto` means the cron set it. `auto` is only ever paired with `eol`, enforced by a check constraint: `eol_stage = 'none'` requires `eol_source IS DISTINCT FROM 'auto'`, and `eol_stage <> 'none'` requires `eol_source IS NOT NULL`. The migration backfills `observed` onto every row whose stage is not `none` (there was no automatic EOL writer before it).
- **Clients never send `eolSource`.** The server derives it: any `eolStage` that arrives through `updateConnection`, and any non-`none` `eolStage` through `createConnection` (the API routes, and the client's sig-to-connection populate that goes through them), is `observed`. A `createConnection` at `none` leaves it `NULL`. Only the cron writes `auto`. Paths that create at `none` (location-poll auto-link, `ensureTopology`) leave it `NULL`. `restoreConnection` leaves it untouched.
- **Confirming an estimate is an observation.** A human committing **any** `eolStage` on an `auto` row, **including the same `eol`**, flips it to `observed` **and re-stamps `eol_at` to now**, even though an unchanged stage normally keeps `eol_at`. The scout's sighting is the real "≤4h left" data point, and the auto stamp was a guess.
- **A human-touched row is never auto-marked.** The cron only targets `eol_source IS NULL`. A scout clearing an estimate (setting `none`) makes it `observed` and the cron leaves it alone. That hole falls back to the 48h cap, which is acceptable.
- **Mark time:** a row is eligible once `created_at + nominal − WORMHOLE_EOL_NOMINAL_MS ≤ now()`. This reuses the existing 4h constant and adds no new config. The cron stamps **`eol_at = now()`, not the estimated entry time**, so an estimate is always on screen for the full `eol` reap clock (`WORMHOLE_EOL_LIFETIME_MS`) before `eolExpiry` takes it. Opting a map in, or typing a sig late on an old hole, therefore never mass-reaps on the next tick. `born_at` is an upper bound on spawn, so the estimate errs late, never early, for a correctly typed hole.
- **Nominal lifetime:** dogma `wormholeMaxStableTime` (minutes, on `universe_type_attribute_effective`, attribute resolved **by name**). On the dev DB this is 270, 720, 960, 1440 or 2880 minutes, and K162 has none. **The type comes from the bound signatures**, using the same rule as Stage 1's `wormholeCode`: exactly one distinct non-K162 code. **Fallback:** when no code resolves and `is_static` is set, use the source system's static whose `target_class` equals the target system's `security`, but only if exactly one matches (the same join as `staticMatchForConnection`, done set-wise in SQL). Anything else (K162-only, untyped, disagreeing, ambiguous static) is never auto-marked and falls to the 48h cap.
- **Eligibility:** `ap_map.auto_eol_connections = true`, `ap_map.deleted_at IS NULL`, `scope = 'wh'`, `eol_stage = 'none'`, `eol_source IS NULL`, `confirmed_at IS NOT NULL` (dormant holes are hidden and die under the 48h sweep with `wasDormant`). 48h types are not excluded: they are marked at 44h, which is a correct estimate, and the 48h cap usually reaps them first.
- **Opt-in:** new `ap_map.auto_eol_connections boolean NOT NULL DEFAULT false`, with its own toggle in `MapBehaviorForm`. It is independent of `delete_eol_connections`: on a map without EOL reaping, an estimate still shows on the map but is never acted on.
- **Discord:** auto-marks are **not posted** to webhooks. **Audit:** they appear in the automation bucket, described as an estimate (e.g. "EOL estimated from age → ~4h"), never with the wording a scout's EOL gets.
- **Not in scope:** auto-advancing to `critical`; reverting an estimate when a sig's type is later corrected (a human clears it, and that makes it `observed`); the "Expires in X" hint using per-type nominal instead of 48h.

---

## Stage 5a — EOL provenance schema
**Mode:** Execute
**Status:** done — e9395ead
**Goal:** Land the `eol_source` enum and column, the `auto_eol_connections` map flag, the check constraint and the `observed` backfill, with the shared `EolSource` type.
**References:** `src/db/schema/ap/enums.md`, `src/db/schema/ap/map_connection.md`, `src/db/schema/ap/map.md`, `src/types/index.md`
**Touches:** `src/db/schema/ap/enums.ts`, `src/db/schema/ap/map_connection.ts`, `src/db/schema/ap/map.ts`, `src/types/index.ts`, a migration at the next free number (`drizzle-kit generate`, plus the backfill `UPDATE` appended by hand) and its hand-written `.rollback.sql`, and their companions.
**Done when:** the migration applies on the dev DB, the backfill leaves no row with `eol_stage <> 'none' AND eol_source IS NULL`, the check constraint rejects `('none', 'auto')` and `('eol', NULL)`, and the rollback drops the constraint, both columns and the enum cleanly. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

## Stage 5b — Human EOL writes record `observed`
**Mode:** Execute
**Status:** done — 47b6386b
**Goal:** Make every human EOL write path stamp `eol_source = 'observed'` and carry `eolSource` on the `connection.create` / `connection.update` payloads, including the confirm-an-estimate re-stamp.
**References:** `src/lib/map/mutations/connections.md`, `src/lib/realtime/protocol.md`, `src/lib/map/transfer.md`, `src/db/schema/ap/map_connection.md`
**Touches:** `src/lib/map/mutations/connections.ts`, `src/lib/realtime/protocol.ts` (optional `eolSource` on the `connection.create` and `connection.update` members), `src/lib/map/transfer.ts`, their companions, and a DB integration test.
**Runs directly after 5a.** 5a's check constraint is live, so until this stage lands every human write of a non-`none` stage fails it: `createConnection` / `updateConnection` with an `eolStage`, and transfer import of an EOL'd connection, return a failed mutation. On the 5a tree, `tests/integration/map-system-connection-mutations.test.ts` has two red tests: the EOL round-trip (its `updateConnection` to `critical` hits the constraint) and the `removeSystem` abyssal test after it, which inherits the round-trip's undeleted `wh` row. Both go green from this stage's writer change alone. The direct-insert fixtures (`housekeeping.test.ts`, `connection-lifecycle-view.test.ts`, `scripts/seed-demo-map.ts`) already carry `eolSource: 'observed'` from 5a.
**Transfer:** export carries `eolSource` and `autoEolConnections`. On import, both are optional: an absent `eolSource` on a row whose stage is not `none` means `observed`, because exports from before 5a predate auto-marking. An absent flag means `false`. Per the settled design, `eol_at` is re-stamped on import, and a round-tripped `auto` row stays `auto`.
**Done when:** `tests/integration/map-system-connection-mutations.test.ts` is green again, and a DB test asserts that creating with `eolStage = 'eol'` stores `observed`; that updating any stage (including `none`) stores `observed`; and that on a row hand-set to `('eol', 'auto')` an update to the same `eol` flips it to `observed` and advances `eol_at`. Each is read from both the row and the stored `ap_map_event.payload`. A transfer round-trip preserves `eol_source`. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

## Stage 5c — Provenance in the death snapshot and read model
**Mode:** Execute
**Status:** done — bdf21a91
**Goal:** Carry `eolSource` into every `connection.delete` snapshot and surface it as `ap_connection_lifecycle.eol_source`.
**References:** `src/lib/map/connectionDeathSnapshot.md` (Stage 1's snapshot reader), `src/lib/realtime/protocol.md`, `src/db/views/connection_lifecycle.md`
**Touches:** `src/lib/map/connectionDeathSnapshot.ts` (+ companion), `src/types/index.ts` (`ConnectionDeathSnapshot` gains `eolSource`), the `connection.delete` member of `mapEventPayloadSchema` (optional `eolSource`), `src/db/views/connection_lifecycle.sql` + companion, a custom migration (`drizzle-kit generate --custom`) doing `CREATE OR REPLACE VIEW` with the column appended last + its `.rollback.sql` restoring the Stage 4 definition (migration 0075's body), and the Stage 4 view test (`tests/integration/connection-lifecycle-view.test.ts` + companion).
**View column:** `eol_source` is payload `eolSource`, else `'observed'` when the payload lacks it and `eolStage <> 'none'` (deaths snapshotted before 5b, when every EOL was human), else `NULL`. The companion states that `cause = 'eol_reaped' AND eol_source = 'auto'` rows have a lifetime set by the cron's clock, not measured.
**Done when:** the Stage 4 view test is extended so that a connection hand-set to `('eol', 'auto')` and then reaped by `eolExpiry` yields `eol_source = 'auto'`, a human-EOL'd one yields `observed`, and a hand-inserted Stage-1-shape snapshot with `eolStage = 'eol'` and no `eolSource` yields `observed`. Migration and rollback apply cleanly. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

## Stage 5d — The auto-EOL cron
**Mode:** Execute
**Status:** done — 106fe78a
**Goal:** Ship the cron that marks eligible holes `('eol', 'auto')` per the settled design, kept out of Discord and labelled as an estimate in the audit log.
**References:** `src/lib/jobs/tasks/eolExpiry.md` (the shape to follow), `src/lib/jobs/registry.md`, `src/lib/map/mutations/core.md`, `src/lib/eve/wormholeJumpInfo.md` (attribute-by-name resolution), `src/lib/map/wormholeTypes.md` (`staticMatchForConnection` join), `src/lib/map/connectionDeathSnapshot.md` (the `wormholeCode` rule), `src/lib/webhooks/dispatcher.md`, `src/lib/webhooks/formatters.md`
**Touches:** a new `src/lib/jobs/tasks/autoEol.ts` + companion, `src/lib/jobs/registry.ts`, `src/lib/webhooks/dispatcher.ts` and/or `src/lib/webhooks/formatters.ts`, their companions, and job integration tests.
**Constraints:**
- **No `server-only` imports.** The task runs in the bare-tsx runner, and both `wormholeJumpInfo.ts` and `wormholeTypes.ts` import `server-only`. Resolve the attribute and do the static join in the task's own SQL, or in a runner-safe helper.
- **Reuse Stage 1's bound-code rule, don't re-derive it.** Stage 1 shipped it per-connection only, as the TS function `boundWormholeCode(codes)` in `src/lib/map/connectionDeathSnapshot.ts` (unit-tested in `tests/unit/connection-death-snapshot.test.ts`), applied to codes the reader fetches per connection. So this stage lifts it into a shared set-wise SQL fragment, exported from that runner-safe module, and switches `readConnectionDeathSnapshot` to it as well, keeping Stage 1's integration test (`tests/integration/connection-death-snapshot.test.ts`) green. Add `src/lib/map/connectionDeathSnapshot.ts` (+ companion) to this stage's touch list.
- **The `UPDATE` is conditional** (`WHERE eol_stage = 'none' AND eol_source IS NULL`) inside the `commitMapEvent` `mutate`, so a scout's concurrent write wins. One `connection.update` per marked row, with `characterId: null` and a payload of `eolStage: 'eol'`, `eolAt`, `eolSource: 'auto'` plus the `source`/`target` descriptors. Batch with `JOB_DELETE_BATCH_SIZE`. Cadence is a hard-coded cron string (every 5 minutes, matching `eolExpiry`). An unresolvable attribute marks nothing and says so in `ap_job_run.notes`.
**Done when:** job tests on an opted-in map show that an O477-typed hole past `nominal − 4h` is marked `('eol', 'auto')` with `eol_at ≈ now()`; that one short of it, a K162-only hole, a dormant hole, an `observed`-`none` hole and a hole on a non-opted map are untouched; that an untyped `is_static` hole with a single matching static is marked; and that the emitted event is not dispatched to webhooks while `describeMapEvent` renders it as an estimate. `pnpm lint`, `pnpm typecheck`, `pnpm build` green, and `pnpm dev` boots the runner with the task registered (the only gate that catches a `server-only` import).

## Stage 5e — `eolSource` reaches every reader
**Mode:** Execute
**Status:** done — 3df7b3ab
**Goal:** Plumb `eolSource` to the map client, the public spectator snapshot and the user API, so every consumer that sees `eolStage` can tell an estimate apart.
**References:** `src/lib/map/loadMap.md`, `src/lib/map/loadPublicMap.md`, `src/lib/map/applyEvent.md`, `src/lib/map/client.md`, `src/lib/userApi/projection.md`, `docs/api/README.md`
**Touches:** `src/lib/map/loadMap.ts`, `src/lib/map/loadPublicMap.ts`, `src/lib/map/applyEvent.ts` (and the client connection type it feeds), `src/lib/userApi/projection.ts`, `docs/api/README.md` (additive `eolSource` field on connections), `src/lib/map/mutations/restoreConnection.ts`, `src/lib/jobs/locationCommit.ts` and `src/lib/map/ensureTopology.ts` (see below; `ensureTopology` also emits `connection.create` and needs `eolSource: null` if the edge body makes the field required), and their companions.
**Re-broadcast emitters:** 5b put `eolSource` on the `connection.create` body only as an optional field, and only `createConnection` and transfer import fill it. `restoreConnection` and `locationCommit`'s re-confirm of an existing row both re-emit the full edge as `connection.create` from the row, and `applyEvent` replaces the whole edge with that payload. So an `auto` row restored or re-confirmed arrives without `eolSource` and would render as if it had none. Both must return the row's `eol_source`. Once every `connection.create` emitter carries it (`ensureTopology` and the location-poll auto-link insert at `none`, so `null`), consider making it required on `connectionEdgeBody`.
**Done when:** `eolSource` is present on loaded and realtime-applied connections, on the public snapshot and in the user API connection projection, covered by the existing tests for those modules extended with an `auto` row. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

## Stage 5f — Render estimates distinctly, with a one-click confirm
**Mode:** Execute
**Status:** done — 81e312b0
**Goal:** Render an `auto` EOL visibly as an estimate, on the map and the public share view, with a confirm that every tab, the acting one included, shows as `observed` once committed.
**References:** `src/components/map/styling.md`, `src/components/map/ConnectionDetailPopover.md`, `src/components/sidebar/InspectorModule.md`, `src/components/map/MapContextMenu.md`, `src/components/map/MapCanvas.md`
**Touches:** `src/components/map/styling.ts`, `src/components/map/ConnectionDetailPopover.tsx`, `src/components/sidebar/InspectorModule.tsx`, `src/components/map/MapContextMenu.tsx`, `src/components/map/MapCanvas.tsx`, and their companions.
**Contract:** an `auto` edge keeps the EOL treatment but is visibly marked as an estimate in the edge styling and in the popover and inspector wording. Every EOL control lets a human re-select the current `eol` on an `auto` row (that's the confirm, which 5b turns into `observed`). `eolSource` is on `MapConnectionEdge` and `PublicMapConnectionEdge` (5e), and `PublicConnectionEdge` renders through the same `connectionStyle` / `connectionBadges`, so widening their `Pick` to `eolSource` covers the public view with no change to the public component.
**Acting tab:** `MapCanvas`'s `onConnectionPatch` applies only the optimistic `{ id, ...patch }` and, on success, marks the server's `eventId` applied so the WS echo is skipped. It never folds the server's payload, so the server-derived `eolSource: 'observed'` (and a re-stamped `eolAt`) never reaches the tab that clicked: without a change there, a confirm leaves the estimate marking on the confirmer's own screen until reload. Folding the committed `connection.update` payload, or deriving those fields in the optimistic one, are both acceptable.
**Done when:** an `auto` connection's rendered output differs from an `observed` one's (component or styling unit test), and a test shows the acting tab's edge reads `eolSource: 'observed'` after a successful EOL patch on an `auto` row. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

## Stage 5g — Ship the toggle
**Mode:** Execute
**Status:** todo
**Goal:** Expose the `auto_eol_connections` toggle, which is what turns the feature on.
**References:** `src/components/map/manage/MapBehaviorForm.md`, `src/app/(app)/actions/map.md`
**Touches:** `src/components/map/manage/MapBehaviorForm.tsx`, `src/app/(app)/actions/map.ts`, and their companions.
**Contract:** the toggle is labelled so a map owner understands it shows *estimated* EOLs on everyone's map.
**Done when:** the toggle persists through the map settings Server Action. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

---

## Stage 6 (optional) — Clean measurement run
**Mode:** Barrier
**Status:** todo
**Goal:** With the instrumentation above in place, run a deliberate lifetime experiment rather than another opportunistic reconstruction.
**References:** `src/db/views/connection_lifecycle.md` (Stage 4's read model), `src/lib/jobs/tasks/expiredConnections.md`
**Approach:** tag a set of home statics, leave rolling off on them, let them run to natural collapse, and lean on `last_alive_at` plus the typed `cause` to timestamp and classify each death. Optionally tier the `expiredConnections` cap nearer nominal-plus-margin for the tagged set so junk is pruned sooner — but only after Stage 3, since a tighter cap without better alive-detection risks deleting a genuinely-open, uncleared hole. That tiering is a code change with its own design; scope it in this session rather than assuming it.
**Done when:** the read model yields a natural-collapse-only distribution for O477/B274 with clear-lag bounded per hole, good enough to state a real over-run figure rather than an upper bound. The run itself is worked through `## Manual verification`.

---

## Sequencing notes

- Stages 1 and 2 are load-bearing: everything after them reads the death snapshot they write. Stage 1 settles the cause taxonomy and the shared snapshot reader; Stage 2 is mechanical reuse of both across the crons.
- Stage 3 is independent of Stage 2 and can run in either order after Stage 1.
- Stage 4 needs Stages 1 and 2 landed (its test reaps through a cron). Stage 3 only improves the data it reads, not its shape.
- Stage 5 is the largest behavioural change and the one most able to corrupt the dataset if the auto/observed distinction is sloppy; keep it behind Stage 4 so its output is immediately inspectable.
- 5a and 5b depend only on the schema and can run any time, but **5b must follow 5a immediately**: between them, human EOL writes fail 5a's check constraint. 5c needs Stages 1, 4 and 5b. 5d needs Stage 1 (the `wormholeCode` rule) and 5b (the `connection.update` field). 5e needs 5b. 5f needs 5e. 5g goes last because its toggle is the only way to switch the feature on, so nothing auto-marks before estimates render distinctly.

## Manual verification
_(worked by the user once, after the run — the plan is not complete until it passes)_
- **Stage 2** — after a live cron reap on a real map, the audit-log entry and the Discord message for the collapsed hole still name both endpoint systems correctly; the enriched payload must not have broken the formatters.
- **Stage 3** — paste the same probe-scan result twice from the in-game client into a live mapped chain, a few minutes apart. The mapped connections stay on the map and their heartbeat advances (`ap_map_connection.confirmed_at` moves to the second paste's time; it is not shown in the UI); nothing is dropped or duplicated by the second paste.
- **Stage 5f / 5g** — on a live opted-in map, let a typed hole cross `nominal − 4h`. It turns EOL, visibly marked as estimated (dot-broken dash, `EOL?` badge, "estimated" in the hover popover, `est.` after the countdown in the system overlay and beside the signature table's EOL picker), in two tabs and on the public share view. The inspector's **Confirm EOL** button, the context menu's `Confirm EOL (estimated)` item, and re-picking EOL in the signature table's EOL cell each drop the estimate marking and restart the countdown in both tabs, the clicking one included. Clearing an estimate to `none` keeps it cleared on the next cron tick.
- **Stage 6** — the measurement run itself: tagged statics left unrolled to natural collapse, deaths classified by cause, clear-lag bounded per hole.

## Notes
_(appended by executing sessions — non-obvious findings only)_
- `removeSystem` dormants incident `wh` connections (`confirmed_at = NULL`) instead of deleting them, so there is no `connection.delete` at endpoint removal and no `endpoint_removed` cause. Those holes die later under the blind 48h sweep, which is why `wasDormant` is on the snapshot: without it, abandonment-by-removal is indistinguishable from genuine 48h staleness.
- The bulk-paste orphan sweep (`removeOrphanedConnections`) is the only delete path backed by a direct scanner observation that the hole is gone. It routes through the same `deleteConnection` as a user click, so without a distinct `sig_orphaned` cause the best natural-collapse evidence in the system is silently merged into `manual_removed`.
- `eol_stage` has four values, not three: `none` / `eol` / `critical` / `expired`, the last being a terminal manual marker (migration 0053) reaped on its own `WORMHOLE_EXPIRED_LIFETIME_MS` clock. Any cause or read-model logic keying off EOL must handle all four.
- The original study's way of getting `wormhole_code` (joining it from signature events) is unsound, which is why Stage 1 snapshots it. `signature.update` carries `wormholeCode` only when the type changed (the full-row `snapshot` is a later addition), a sig can be unlinked and rebound, the two ends of a hole often disagree (one K162, one real code), and Thera sync binds no signature at all. The bound sig rows read at death time are the only reliable source.
- The bulk-paste orphan sweep deletes the orphaned signature *before* calling `deleteConnection`, so by snapshot time the sig whose disappearance triggered the delete (usually the typed near-side one) is already gone from the bound-sig read. Without `removedBoundSigTypeIds` the strongest natural-collapse evidence would mostly record `K162` or `null`. Reordering to delete the connection first is not an option: the sig would cascade silently, with no `signature.delete` event for the audit trail or other tabs.
- `wormholeCode` is only as good as the bound sigs that survive to death. A bound sig that expires first (the reap cron, or the paste ghost sweep) takes its type with it, and that path is not compensated. Long-lived holes whose sigs went unrefreshed can die with `wormholeCode: null`.
- A partial index on `ap_map_event (occurred_at) WHERE kind = 'connection.delete'` is the lever if `ap_connection_lifecycle` ever gets slow. It was left out of Stage 4 because building an index on the partitioned parent can't run `CONCURRENTLY` and blocks event writes for the duration of the build on prod.
- Dormanting (`removeSystem`) sets `confirmed_at = NULL` and leaves `updated_at` alone, so the death snapshot of a hole that died dormant has no confirmation term in `lastAliveAt`, only the mass log and the last edit. A Stage 3 scan heartbeat on such a hole is wiped at removal, not carried to death.
- The scan heartbeat rides the paste's `updateExisting` branch, because that is where each re-listed sig gets its `signature.update` event of record. A paste with "update existing" unchecked records no re-observation. The single-sig PATCH route is deliberately not a heartbeat: it is a human field edit, not a scanner sighting, and counting it would let typing on a dead hole's sig extend its `lastAliveAt`.
- `ap_connection_lifecycle` casts payload `id` / `source` / `target` to `bigint` and the timestamp fields to `timestamptz` (only enum-valued fields stay `text`). Every emitter writes those as bigint/ISO strings, but a hand-inserted `connection.delete` with a non-numeric id or an unparseable time, once it carries `cause`, makes every query over the view error. Hand-written test or repair events must keep those shapes.
- Drizzle's `db.execute` over node-postgres returns `timestamptz` columns as raw strings, not `Date`, so the Stage 4 view test reads its timings as `extract(epoch ...)` milliseconds in the query.
- `drizzle-kit generate` emits a new check constraint in the same file as its column, so a backfill the constraint depends on cannot simply be appended: in 0076 the `observed` `UPDATE` sits between `ADD COLUMN` and `ADD CONSTRAINT`, or the constraint fails on any existing EOL row. The dev DB had no non-`none` connections, so the backfill was exercised by seeding EOL rows inside a rolled-back transaction (rollback SQL, seed, forward SQL, assert).
- **A create at `none` leaves `eol_source` NULL, not `observed`.** The settled design's "any `eolStage` through `createConnection` is `observed`" would, for a client that always sends its default `none` on create, mark every hand-drawn hole as human-touched and so permanently ineligible for the cron. Seeing a hole as not-yet-decaying at creation says nothing about when it will decay; only clearing an existing EOL (an `updateConnection` to `none`) is the "don't estimate this" signal. No current client sends `eolStage` on create except at a non-`none` value, so today the two readings behave the same.
- **Stage 5b:** the 0076 check constraint does not enforce "`auto` only with `eol`" (`(critical, auto)` and `(expired, auto)` are legal rows), so any writer taking `eolSource` from untrusted input, such as transfer import, must clamp it itself; 5b's `Done when` only covered a genuine round-trip.
- **Stage 5d:** the static fallback keys on the bound code being NULL, so it covers both an untyped hole and one whose bound non-K162 codes disagree, but not a K162-only hole: `K162` is a resolved code with no lifetime, and the settled design lists K162-only as never marked even when `is_static` is set.
- **Stage 5d:** an estimate's `connection.update` is still enqueued as a `webhook-dispatch` job on a map with webhooks, because `commitMapEvent` gates the enqueue on `AUDIT_ONLY_EVENT_KINDS` alone. The dispatcher drops it (`isEolEstimateEvent`) before resolving any context. Gating it at enqueue would need `core.ts` to read the payload.
- **Stage 5d:** `boundWormholeCode` (TS) is gone: once `readConnectionDeathSnapshot` used the SQL fragment, nothing called it. Its unit cases moved into `tests/integration/connection-death-snapshot.test.ts`, run against the fragment over literal `VALUES`, because a unit test cannot evaluate SQL.
- **Stage 5e:** `eolSource` on the `connection.create` edge body is `.nullable().default(null)`, not strictly required. The audit browser and the webhook dispatcher `safeParse` stored `ap_map_event` payloads with `mapEventPayloadSchema`, so a required field would make every `connection.create` stored before 5b fail to parse and lose its audit description. The default fills only those; every live emitter sends the row's value, and the inferred `MapEventPatch<'connection.create'>` makes it a compile error to omit.
- **Stage 5e:** the dev DB had Blackout switched on (`ap_instance.blackout_since` set), which makes `location-poll-jumps.test.ts` (wormhole folds are skipped) and the two public-presence cases of `public-map-view.test.ts` fail on an untouched tree. They pass with the switch briefly cleared; restore its exact prior value afterwards.
- **Stage 5f:** base-ui's `Select` and menu `RadioGroup` both fire `onValueChange` when the already-selected value is picked again, so every EOL control (inspector select, context-menu radio, the signature table's `EolStageSelect`) can already confirm an estimate by re-picking `eol`. The dedicated Confirm buttons exist for discoverability. If a base-ui upgrade adds an equality short-circuit, re-pick confirming quietly stops working and only those buttons remain.
- **Stage 5f:** three surfaces render EOL without going through `connectionBadges`' label: `SystemOverlay`'s connection rows (they drop the badge for their own countdown), `MapInfoDialog`'s connections table (its own label switch) and `SignatureModule`'s EOL cell (a stage picker showing the linked connection's stage). All three call `isEolEstimate` themselves, and so must any new EOL surface. None was in 5f's original `Touches`, which listed only the components holding an EOL control or badge.
- **Stage 5f:** the acting tab's optimistic `connection.update` never carried `eolAt`, so a stage change by the clicking tab didn't restart its own countdown either, until reload. `applyCommittedEolFields` folds the server's `eolAt`/`eolSource` from the committed payload and covers both.
