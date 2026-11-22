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
**Status:** todo
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
**Status:** todo
**Goal:** Make both cron reapers emit the same cause-plus-snapshot payload as the manual path, so no death escapes the instrumentation.
**References:** `src/lib/jobs/tasks/eolExpiry.md`, `src/lib/jobs/tasks/expiredConnections.md`, `src/lib/map/mutations/core.md`, plus Stage 1's snapshot-reader companion
**Touches:** `src/lib/jobs/tasks/eolExpiry.ts`, `src/lib/jobs/tasks/expiredConnections.ts`, their companion `.md` files, and the job integration tests.

**Constraint:** both reapers currently delete-with-`RETURNING` the endpoint ids only. The snapshot (including the mass-log max) must be captured in the same transaction as the delete — a pre-select inside the `commitMapEvent` `mutate` or a CTE, not a separate read before it.

**Done when:** an `eolExpiry` sweep emits `eol_reaped` and an `expiredConnections` sweep emits `expired_swept`, both with the full snapshot; a swept connection that was dormant carries `wasDormant: true`; DB integration tests cover both sweeps. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

---

## Stage 3 — Scan re-observation heartbeat
**Mode:** Execute
**Status:** todo
**Goal:** Bump `confirmed_at` every time a probe-scan paste re-lists a mapped connection's signature, so holes nobody jumps but scanners keep seeing still get a fresh "known open at" stamp, tightening the clear-lag bound.
**References:** `src/lib/map/mutations/bulkSignatures.md`, `src/lib/map/mutations/signatures.md`, `src/db/schema/ap/map_connection.md`
**Touches:** `src/lib/map/mutations/bulkSignatures.ts` (and `signatures.ts` if the single-sig update path shares the gap), their companion `.md` files, tests.

**Established gap:** `confirmed_at` is stamped on create (explicitly by `createConnection`, by column default elsewhere), re-stamped by `restoreConnection` and by the location-poll auto-link, and NULLed by `removeSystem`. **No paste path touches it** — so a hole that is scanned every hour for a day looks, at death, exactly as stale as one nobody has looked at since it was mapped. Closing this is what makes `lastAliveAt` meaningful for holes without tracked jumps.

**Done when:** re-pasting a scan that still lists a mapped connection's signature advances that connection's `confirmed_at`, covered by a test; the advanced value flows into Stage 1's `lastAliveAt` derivation without further change.

---

## Stage 4 — Connection-lifecycle read model
**Mode:** Execute
**Status:** todo
**Goal:** Ship `ap_connection_lifecycle`, a plain SQL view that projects every instrumented `connection.delete` event into one lifecycle row per dead connection, replacing the session-local `home_wh_life` / `conn_static` temp views the original study hand-rolled.
**References:** `src/db/views/activity_rollup.md` (the SQL-source-file + custom-migration precedent for a view over `ap_map_event`), `src/db/schema/ap/map_event.md`, `src/db/schema/ap/map_system.md`, Stage 1's snapshot-reader companion, `src/lib/realtime/protocol.md` (`connection.delete` payload), `src/types/index.md` (`ConnectionDeathCause`)
**Touches:** `src/db/views/connection_lifecycle.sql` + `src/db/views/connection_lifecycle.md` (source of truth + companion), a custom migration at the next free number (`src/db/migrations/00NN_connection_lifecycle_view.sql`, generated with `drizzle-kit generate --custom` so the journal records it) + its hand-written `.rollback.sql`, and one DB integration test. No Drizzle handle and no TS reader: the consumer is operator SQL. Add a `pgView(...).existing()` handle only if a TS reader appears.

**Settled design:**
- **Plain view, not materialized.** The only reader is an analyst running occasional queries, so a seq scan over the `connection.delete` events is acceptable. A materialized form would need a refresh job and a stale window, and nothing needs that speed. No new table, no dual-write.
- **Source rows:** `ap_map_event` where `kind = 'connection.delete'` **and** the payload carries the snapshot (`payload ? 'cause'`). Pre-Stage-1 deletes are **excluded outright**. They have no cause, no last-alive and no death state, and backfilling them by pairing with create events is the forensic reconstruction this plan exists to retire.
- **No create-event pairing.** The snapshot's `bornAt` is the row's `created_at`. `restoreConnection` and the location-poll reconfirm both re-emit `connection.create` with the same id and the same `createdAt`, so a create join would fan out per re-confirm. The view reads the delete event alone, which gives exactly one row per connection id.
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
| `was_rolled` | `cause = 'rolled' OR isRolling` (a cron can reap a hole that was mid-roll) |
| `was_dormant` | payload `wasDormant` |
| `eol_stage_at_death` | payload `eolStage` (all four values) |
| `eol_at` | payload `eolAt` → timestamptz |

**Done when:** the migration applies on the dev DB and its `.rollback.sql` drops the view cleanly. A `RUN_DB_TESTS` integration test, scoped to its own map and cleaning up after itself (the suite hits the live dev DB), asserts that:
- connections deleted with each of `manual_removed`, `rolled` and `sig_orphaned`, plus one reaped by a cron, each yield exactly one row with the expected `cause`, `born_at`, `lifetime_h`, `clear_lag_h`, `was_rolled` and `wormhole_code`;
- a connection dormanted by `removeSystem`, restored, then deleted yields exactly one row;
- a hand-inserted `connection.delete` event with a pre-Stage-1 payload (`{ id, source, target }` only) is absent from the view.

`pnpm lint`, `pnpm typecheck`, `pnpm build` green.

---

## Stage 5 — Age-based auto-EOL marking
**Design pass:** the auto vs observed EOL distinction and its schema — needs its own planning session before execution starts.
**Status:** todo
**Goal:** Mark a wormhole `eol_stage = 'eol'` automatically as it approaches its type's catalogued lifetime, so abandoned holes get reaped by `eolExpiry` near nominal instead of rotting to the 48h `expiredConnections` cap. This is what kills the stale pile at the source.

**The design risk that gates this stage:** an age-based EOL is a *guess* about collapse, not an observation. It must be distinguishable from a human/observed EOL — an `eol_source` marker of `auto` vs `observed`, carried through to the death snapshot — so the lifecycle read model can exclude auto-marked holes from any "how long do they really last" measurement. Getting this wrong launders guesses into the dataset as data, which is the exact failure this whole effort exists to prevent.

**Known scope beyond the original sketch:** this needs a schema migration (`eol_source` on `ap_map_connection`, plus its enum), a new cron task with registry entry and companion, the per-type nominal lifetime read via the static catalog (`staticMatchForConnection` / `src/db/schema/universe/statics.ts`), and a decision on whether auto-EOL is opt-in per map like the two existing reapers. `eolSource` must ride the death snapshot (an optional field on the `connection.delete` schema in `protocol.ts`, read by Stage 1's shared reader), and `ap_connection_lifecycle` gains an `eol_source` column. `CREATE OR REPLACE VIEW` can append a column at the end, so that's a new custom migration and an edit to `src/db/views/connection_lifecycle.sql` and its companion.

_(`Mode`, `References`, `Touches`, `Done when` are filled in by that session, which may also split this stage.)_

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
- Stage 5 still needs its own planning session before any execution run reaches it.
- Stage 5 is the largest behavioural change and the one most able to corrupt the dataset if the auto/observed distinction is sloppy; keep it behind Stage 4 so its output is immediately inspectable.

## Manual verification
_(worked by the user once, after the run — the plan is not complete until it passes)_
- **Stage 2** — after a live cron reap on a real map, the audit-log entry and the Discord message for the collapsed hole still name both endpoint systems correctly; the enriched payload must not have broken the formatters.
- **Stage 3** — paste the same probe-scan result twice from the in-game client into a live mapped chain, a few minutes apart. The mapped connections stay on the map and their heartbeat advances; nothing is dropped or duplicated by the second paste.
- **Stage 6** — the measurement run itself: tagged statics left unrolled to natural collapse, deaths classified by cause, clear-lag bounded per hole.

## Notes
_(appended by executing sessions — non-obvious findings only)_
- `removeSystem` dormants incident `wh` connections (`confirmed_at = NULL`) instead of deleting them, so there is no `connection.delete` at endpoint removal and no `endpoint_removed` cause. Those holes die later under the blind 48h sweep, which is why `wasDormant` is on the snapshot: without it, abandonment-by-removal is indistinguishable from genuine 48h staleness.
- The bulk-paste orphan sweep (`removeOrphanedConnections`) is the only delete path backed by a direct scanner observation that the hole is gone. It routes through the same `deleteConnection` as a user click, so without a distinct `sig_orphaned` cause the best natural-collapse evidence in the system is silently merged into `manual_removed`.
- `eol_stage` has four values, not three: `none` / `eol` / `critical` / `expired`, the last being a terminal manual marker (migration 0053) reaped on its own `WORMHOLE_EXPIRED_LIFETIME_MS` clock. Any cause or read-model logic keying off EOL must handle all four.
- The original study's way of getting `wormhole_code` (joining it from signature events) is unsound, which is why Stage 1 snapshots it. `signature.update` carries `wormholeCode` only when the type changed (the full-row `snapshot` is a later addition), a sig can be unlinked and rebound, the two ends of a hole often disagree (one K162, one real code), and Thera sync binds no signature at all. The bound sig rows read at death time are the only reliable source.
- A partial index on `ap_map_event (occurred_at) WHERE kind = 'connection.delete'` is the lever if `ap_connection_lifecycle` ever gets slow. It was left out of Stage 4 because building an index on the partitioned parent can't run `CONCURRENTLY` and blocks event writes for the duration of the build on prod.
