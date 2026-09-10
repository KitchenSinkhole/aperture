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
**Touches:** `src/types/index.ts`, a new death-snapshot reader under `src/lib/map/`, `src/lib/map/mutations/connections.ts`, and the three `deleteConnection` callers (`src/app/api/map/[mapId]/connections/[connId]/route.ts`, `src/lib/map/mutations/subchain.ts`, `src/lib/map/mutations/bulkSignatures.ts`). Their companion `.md` files. No schema migration (payload is jsonb; `event_kind` is unchanged).

**Settled design:**
- **Cause union** (`ConnectionDeathCause` in `src/types/index.ts`), one per delete site, no default:
  - `manual_removed` — a user deleted it (API route, subchain batch).
  - `rolled` — deleted while `is_rolling` is set or `mass_status` is critical. Derived inside the snapshot read, and takes precedence over `manual_removed`.
  - `sig_orphaned` — the bulk-paste orphan sweep removed it because its signature is gone from a fresh scan. **This is the strongest natural-collapse evidence in the system**: a scanner looked and the hole was not there. It must not be folded into `manual_removed`.
  - `eol_reaped` — the `eolExpiry` cron (Stage 2).
  - `expired_swept` — the `expiredConnections` 48h cap (Stage 2).
- **Death snapshot fields** on the payload: `bornAt` (`created_at`), `lastAliveAt`, `massStatus`, `isRolling`, `eolStage`, `eolAt`, `wasDormant` (`confirmed_at IS NULL` at death).
- **`lastAliveAt` derivation:** `greatest(max(ap_map_connection_log.jumped_at), confirmed_at, updated_at)`, read in the same transaction as the delete because the log cascades. It is a lower bound on "known open at" — untracked jumps and scanner sightings do not ping it (Stage 3 widens it). True collapse lies in `[lastAliveAt, deletedAt]`.
- The snapshot reader is shared, so Stage 2's crons reuse it rather than growing a second derivation.

**Done when:** `deleteConnection` requires a cause, its payload carries the full snapshot, and an integration test asserts a plain user delete tags `manual_removed`, a connection with `is_rolling` set tags `rolled`, and a bulk paste dropping a mapped sig tags `sig_orphaned` — each with `bornAt` and a `lastAliveAt` no earlier than a logged jump on that connection. `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

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
**Design pass:** the whole read model — needs its own planning session before execution starts.
**Status:** todo
**Goal:** One durable, queryable object that pairs each `connection.create` with its `connection.delete` and exposes born/died/lifetime/cause/last-alive/rolled, replacing the session-local `home_wh_life` / `conn_static` temp views the original study hand-rolled.

**Shape (per connection):** `connection_id`, `map_id`, `source/target system`, `wormhole_code`, `born_at`, `died_at`, `lifetime_h`, `cause`, `last_alive_at`, `clear_lag_h` (= `died_at - last_alive_at`), `mass_status_at_death`, `was_rolled`, `was_dormant`, `eol_stage_at_death`, `eol_at`.

**Open questions for the design session:**
- SQL view over `ap_map_event` vs a query builder under `src/lib/map/`. No new table (CLAUDE.md: history lives in `ap_map_event`). A materialized form, if wanted for speed, derives from the events and is refreshed, never dual-written.
- Where `wormhole_code` comes from: the study joined it from signature events. Whether that join is sound for every create path (location-poll auto-link, Thera ingest, map transfer) needs checking against the current event payloads.
- How a dormant-then-restored connection reads: `restoreConnection` reuses the row, so there is one create event and one death, but a gap in the middle where the hole was off-map.
- Whether events predating Stage 1 (no `cause`, no snapshot) surface as `NULL` cause or are excluded outright.

_(`Mode`, `References`, `Touches`, `Done when` are filled in by that session, which may also split this stage.)_

---

## Stage 5 — Age-based auto-EOL marking
**Design pass:** the auto vs observed EOL distinction and its schema — needs its own planning session before execution starts.
**Status:** todo
**Goal:** Mark a wormhole `eol_stage = 'eol'` automatically as it approaches its type's catalogued lifetime, so abandoned holes get reaped by `eolExpiry` near nominal instead of rotting to the 48h `expiredConnections` cap. This is what kills the stale pile at the source.

**The design risk that gates this stage:** an age-based EOL is a *guess* about collapse, not an observation. It must be distinguishable from a human/observed EOL — an `eol_source` marker of `auto` vs `observed`, carried through to the death snapshot — so the lifecycle read model can exclude auto-marked holes from any "how long do they really last" measurement. Getting this wrong launders guesses into the dataset as data, which is the exact failure this whole effort exists to prevent.

**Known scope beyond the original sketch:** this needs a schema migration (`eol_source` on `ap_map_connection`, plus its enum), a new cron task with registry entry and companion, the per-type nominal lifetime read via the static catalog (`staticMatchForConnection` / `src/db/schema/universe/statics.ts`), and a decision on whether auto-EOL is opt-in per map like the two existing reapers.

_(`Mode`, `References`, `Touches`, `Done when` are filled in by that session, which may also split this stage.)_

---

## Stage 6 (optional) — Clean measurement run
**Mode:** Barrier
**Status:** todo
**Goal:** With the instrumentation above in place, run a deliberate lifetime experiment rather than another opportunistic reconstruction.
**References:** Stage 4's read model companion, `src/lib/jobs/tasks/expiredConnections.md`
**Approach:** tag a set of home statics, leave rolling off on them, let them run to natural collapse, and lean on `last_alive_at` plus the typed `cause` to timestamp and classify each death. Optionally tier the `expiredConnections` cap nearer nominal-plus-margin for the tagged set so junk is pruned sooner — but only after Stage 3, since a tighter cap without better alive-detection risks deleting a genuinely-open, uncleared hole. That tiering is a code change with its own design; scope it in this session rather than assuming it.
**Done when:** the read model yields a natural-collapse-only distribution for O477/B274 with clear-lag bounded per hole, good enough to state a real over-run figure rather than an upper bound. The run itself is worked through `## Manual verification`.

---

## Sequencing notes

- Stages 1 and 2 are load-bearing: everything after them reads the death snapshot they write. Stage 1 settles the cause taxonomy and the shared snapshot reader; Stage 2 is mechanical reuse of both across the crons.
- Stage 3 is independent of Stage 2 and can run in either order after Stage 1.
- Stage 4 and Stage 5 each need their own planning session before any execution run reaches them.
- Stage 5 is the largest behavioural change and the one most able to corrupt the dataset if the auto/observed distinction is sloppy; keep it behind Stage 4 so its output is immediately inspectable.

## Manual verification
_(worked by the user once, after the run — the plan is not complete until it passes)_
- **Stage 2** — after a live cron reap on a real map, the audit-log entry and the Discord/Slack message for the collapsed hole still name both endpoint systems correctly; the enriched payload must not have broken the formatters.
- **Stage 3** — paste the same probe-scan result twice from the in-game client into a live mapped chain, a few minutes apart. The mapped connections stay on the map and their heartbeat advances; nothing is dropped or duplicated by the second paste.
- **Stage 6** — the measurement run itself: tagged statics left unrolled to natural collapse, deaths classified by cause, clear-lag bounded per hole.

## Notes
_(appended by executing sessions — non-obvious findings only)_
- `removeSystem` dormants incident `wh` connections (`confirmed_at = NULL`) instead of deleting them, so there is no `connection.delete` at endpoint removal and no `endpoint_removed` cause. Those holes die later under the blind 48h sweep, which is why `wasDormant` is on the snapshot: without it, abandonment-by-removal is indistinguishable from genuine 48h staleness.
- The bulk-paste orphan sweep (`removeOrphanedConnections`) is the only delete path backed by a direct scanner observation that the hole is gone. It routes through the same `deleteConnection` as a user click, so without a distinct `sig_orphaned` cause the best natural-collapse evidence in the system is silently merged into `manual_removed`.
- `eol_stage` has four values, not three: `none` / `eol` / `critical` / `expired`, the last being a terminal manual marker (migration 0053) reaped on its own `WORMHOLE_EXPIRED_LIFETIME_MS` clock. Any cause or read-model logic keying off EOL must handle all four.
