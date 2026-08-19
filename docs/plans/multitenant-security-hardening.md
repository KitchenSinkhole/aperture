# Multitenant Security Hardening

**Goal:** Close the cross-tenant data-isolation gaps before the public FFA deployment, in priority order: server-side write isolation on map children (a real authorization leak) first, then tenancy scoping for the deployment-global intel tables, then client-side realtime routing (cross-tab display bleed).

**References:**
- `src/lib/auth/rights.md` / `rights.ts` — the actor-authorization gate (`canViewMap` / `canMutateMap` / `requireMapRight`). Already correct; not where the write leak lives.
- `src/app/api/map/README.md` — the JSON API mutation contract.
- `src/lib/map/mutations/core.md`, `signatures.md`, `connections.md`, `bulkSignatures.md`, `systems.md` — the mutation helpers.
- `src/lib/structures/guard.md`, `read.md`, `mutations.md` — the structure-intel stack.
- `src/db/schema/ap/map.md`, `structure.md`, `instance.md` — the owner-triple precedent and the deployment-owner list.
- `src/lib/realtime/bus.md`, `protocol.ts`, `wsServer.md`, `sharedWorker.md`, `useRealtime.md` — the realtime fanout path.
- `src/components/map/MapCanvas.md` — the per-map realtime consumer.
- CLAUDE.md "Mutation pathways", "Realtime", "Database" (real FKs across boundaries).

---

## Threat model

Intel charted in Aperture (scanned signatures, connection chains, pilot presence, structure sightings, system notes) is operationally sensitive. A cross-map or cross-user leak during a PvP engagement or a wormhole siege exposes a defender's chain to the attacker, or lets an attacker corrupt it. On a public FFA deployment the precondition for an attack is only a valid login: `canCreateMap` lets any active character create a private map, on which they hold `map_update`. Any authenticated user can therefore pivot from a throwaway map they own to any other map, and to every row in the deployment-global intel tables.

## Priority ordering

- **P0 (Stages 1 to 2):** server-side cross-tenant write on map children. An authenticated user can inject rows onto a map they cannot see. This is a true authorization leak.
- **P1 (Stages 3 to 9):** the deployment-global intel tables (`ap_structure`, `ap_system_note`) have no owner at all. Every authenticated user can read every row and destroy any row by enumerable id. Also a true authorization leak, and the larger blast radius of the two, but it needs a schema change rather than a guard.
- **P2 (Stages 10 to 12):** cross-tab realtime bleed inside one authorized browser. Display/local-state corruption only; server authorization is not bypassed and a reload clears it.

**Execution state:** P0 and P2 shipped together ahead of P1, since neither depends on the intel-table schema change and P2 was the reported bug. P1 (Stages 3 to 9) is the whole remaining block; the per-stage `Status` lines are authoritative.

**Precondition:** the P1 stages assume PR #242 (global system notes) is merged to `dev` first. It creates `ap_system_note` / `ap_system_note_event` and migration `0068`. If it lands after this plan starts, the P1 block must be re-scoped to structures only (Stages 3 to 5, 8, 9) and the note stages (6 to 7) re-planned.

---

## The P0 defect (Stages 1 to 2)

The actor-authorization gate (`requireMapMutate(urlMap, session, 'map_update')`) runs correctly on every route. The gap is a second, orthogonal check that is missing on the **create** paths: whether the child row named in the request body actually belongs to the map the caller is authorized on.

The read side already defends this. `GET /api/map/[mapId]/systems/[systemId]/signatures` verifies the system belongs to the guarded map, with a comment naming the exact threat ("a viewer of map A could harvest signatures from a system on map B by id"). The update/delete mutation helpers do the same via `apMapSystem.mapId == input.mapId`. The create helpers do not:

- `createSignature` (`signatures.ts`) inserts on the body's `mapSystemId` (and optional `mapConnectionId`) with no ownership check. Both `ap_map_system.id` and `ap_map_signature.id` are `bigserial`, so ids are sequential and enumerable. Result: an authenticated user can inject a fabricated signature onto another map's system (false statics / K162s during a siege), which surfaces on the victim's map on next load.
- `createConnection` (`connections.ts`) inserts `sourceMapSystemId` / `targetMapSystemId` unchecked. Lower blast radius (the new row is stamped with the caller's own `map_id`, so it does not render on the victim's map), but it pollutes the caller's map with cross-map references and acts as a global id existence oracle.
- `pasteSignatures` (`bulkSignatures.ts`) reaches `createSignature` for its add branch, so it inherits the injection; its update/delete branches route through the guarded helpers and already abort on a foreign child.

Two update paths carry the same shape of hole. `updateSignature` joins through `apMapSystem.mapId` to guard the sig's own row, but applies a body-supplied `mapConnectionId` unchecked — so an authorized editor on map A can link one of its sigs to a connection on map B, leaking B's far endpoint back through the `signature.update` payload's `leadsToMapSystemId` and exposing the sig to that connection's `ON DELETE CASCADE`. `pasteSignatures` reads the target system's signatures before any tenancy check, relying on a downstream helper to throw; with `updateExisting` off, an incoming code already present on a foreign system short-circuits the loop so no helper runs and the call returns `ok`, making the ok/reject split an existence oracle for signature codes on any system of any map.

The fix is one shared check reused by every path that takes a child id from the request body: **does this child belong to the authorized map**, not "is this person allowed on this map" (that already runs).

---

## Stage 1 — Tenancy-binding assertion on the write paths

**Mode:** Execute
**Status:** done — 0e5b9195, 7b641b60
**Goal:** A create or update mutation can only attach a child to systems/connections that live on the same map the caller is authorized on. Naming a foreign `ap_map_system.id` / `ap_map_connection.id` is rejected and rolls the transaction back.
**References:** `src/lib/map/mutations/core.md`, `signatures.md`, `connections.md`, `bulkSignatures.md`
**Touches:** new `src/lib/map/mutations/tenancy.ts` (+ `.md`); `src/lib/map/mutations/signatures.ts` (+ `.md`); `src/lib/map/mutations/connections.ts` (+ `.md`).

**Spec:**
- New module `tenancy.ts`, no `import 'server-only'` (mirror `core.ts`: it is reachable from worker-run mutation helpers), exporting two `tx`-scoped asserts:
  - `assertSystemOnMap(tx: Tx, mapSystemId: bigint, mapId: bigint): Promise<void>` — `SELECT id FROM ap_map_system WHERE id = mapSystemId AND map_id = mapId`; throw `Error('System does not belong to this map.')` when absent.
  - `assertConnectionOnMap(tx: Tx, connectionId: bigint, mapId: bigint): Promise<void>` — same shape against `ap_map_connection`; throw `Error('Connection does not belong to this map.')`.
  - Import `Tx` from `./core`.
- `createSignature.mutate`: before the insert, `await assertSystemOnMap(tx, input.mapSystemId, input.mapId)`; when `input.mapConnectionId != null`, also `await assertConnectionOnMap(tx, input.mapConnectionId, input.mapId)`.
- `createConnection.mutate`: before the insert, `await assertSystemOnMap(tx, input.sourceMapSystemId, input.mapId)` and the same for `input.targetMapSystemId`. Asserting both against `input.mapId` also guarantees the edge cannot span two maps, so no separate equality check is needed. This also closes the `createConnection` existence oracle.
- `updateSignature.mutate`: when the patch supplies a non-null `mapConnectionId`, `await assertConnectionOnMap(tx, patch.mapConnectionId, input.mapId)`. The existing join through `apMapSystem.mapId` guards the sig's own row but not the connection the patch points at, and a foreign edge leaks its far endpoint back through the `signature.update` payload's `leadsToMapSystemId` while exposing the sig to that connection's `ON DELETE CASCADE`.
- `pasteSignatures`: `await assertSystemOnMap(tx, input.mapSystemId, input.mapId)` as the first statement in the transaction, before the existing-signature read. Relying on a downstream helper to throw is not sufficient — with `updateExisting` off, an incoming code already present on a foreign system short-circuits the loop so no helper runs and the call returns `ok`, making the ok/reject split an existence oracle for signature codes on any system of any map.
- Error handling is already in place: a throw inside `mutate` rolls back the standalone transaction and surfaces as `{ ok: false, error }`, which the routes map to HTTP 400. In joined-tx callers the throw aborts the outer batch, which is the desired atomic behaviour.
- `addSystemWithStargateLinks` calls `createConnection` with neighbour ids it selected `WHERE map_id = input.mapId`, so the new asserts are satisfied (redundant but harmless).
- Companion updates: state the tenancy invariant in present tense (e.g. `signatures.md` header note becomes "ownership is validated in create/update/delete"); document the two new `tenancy.ts` exports.

**Done when:**
- Both asserts run inside `createSignature.mutate` / `createConnection.mutate` before their inserts (the behavioural gate — cross-tenant writes rejected, same-map writes unchanged — is Stage 2's test suite).
- `pnpm lint && pnpm typecheck && pnpm build` green.

---

## Stage 2 — Cross-tenant write regression tests

**Mode:** Execute
**Status:** done — 4808d4c6, 7b641b60
**Goal:** Lock the Stage 1 invariant so a future write path cannot silently reintroduce the gap.
**References:** `src/lib/map/mutations/tenancy.md` (written by Stage 1), `tests/unit/route-rights-coverage.test.ts`
**Touches:** new spec under `tests/integration/` (+ a note in `tests/unit/route-rights-coverage.test.ts` pointing at it).

**Spec:**
- Add a DB-backed integration test (guarded by `RUN_DB_TESTS`, snapshot/restore around any shared-state rows per the suite convention) that, for each create path (`createSignature`, `createConnection`, and the bulk-add branch of `pasteSignatures`), builds two maps and asserts a create naming the other map's child is rejected and writes nothing, while a same-map create succeeds.
- Cover the update paths on the same shape: `updateSignature` patching in a foreign `mapConnectionId` is rejected, and `pasteSignatures` against a foreign `mapSystemId` is rejected rather than returning `ok` on a code collision.
- Add a short comment explaining why a pure static grep cannot guard this: the authz guard is present and correct on every route, so the only reliable signal is the behavioural attempt-and-reject.
- Suite caveats to respect: `RUN_DB_TESTS` runs against the non-pristine dev DB, so snapshot and restore any rows the test mutates; triage failures in isolation because the full suite is parallel-flaky.

**Done when:** the new spec fails if either Stage 1 assert is removed and passes with it in place. `RUN_DB_TESTS=1 pnpm test <spec>` green.

---

## The P1 defect (Stages 3 to 9)

`ap_structure` and `ap_system_note` are **deployment-global**: neither carries a `map_id` or any owner column. The write gate on both is "is there a session" (`requireStructureMutate`, `src/lib/structures/guard.ts`), and both primary keys are `bigserial`. So on an FFA instance any logged-in stranger can:

- read every structure sighting and every system note in the deployment;
- rewrite or delete any of them by counting ids from 1.

Reads amplify through `GET /api/map/[mapId]/system-data?systems=…`, which guards `requireMapView` on the map but never checks the requested systems are actually on it. 256 arbitrary system ids per request dumps the deployment's structure intel in roughly twenty calls, with no need to add a single system to a map.

This is the intended design for a single-tenant allowlisted deployment, where "any authenticated character" means "any alliance member" and shared intel is the point. It only becomes a leak when login goes FFA.

### The scoping model

**An intel row takes its scope from the map it was written on**, mirroring `ap_map`'s owner triple:

| Map it was written on | Row scope | Visible to |
|---|---|---|
| `type='private'` | `private` | the writing character |
| `type='corp'` | `corp` | members of that corporation |
| `type='alliance'` | `alliance` | members of that alliance |

Two properties follow, and both are load-bearing:

- **Scope never derives from the writer**, only from the map. The writer's own corporation is never consulted, so an NPC corp can never become a scope even on the `hasRoleAccess` guest path onto someone else's corp map. (The `is_director` gate on `canCreateMap` keeps NPC-corp characters from *creating* corp maps, but that is a second line of defense, not the mechanism.)
- **Visibility follows the viewer, not the currently-open map.** A character sees every row whose scope admits them, regardless of which map they have open. So a member on a corp map sees corp rows, alliance rows, and their own private rows, all at once. Intel accumulates for a member rather than fragmenting per map, while staying inside the trust boundary the org expressed by how it laid out its maps.

**Membership change needs no special handling.** A row keeps the owner entity it was written under, and the filter matches on the viewer's *current* `corporation_id` / `alliance_id`, so access revokes itself: a corp leaving an alliance stops matching that alliance's rows, including ones its own members wrote. Intel written on alliance time stays with the alliance. The departing corp keeps its `corp`-scoped rows, which match on `corporation_id` and are unaffected. No migration, no ownership transfer, no cleanup job.

Revocation is therefore exactly as fresh as `ap_character.alliance_id`, which `syncCharacterAuthz` refreshes on sign-in and on the `character-cleanup` periodic resync (`CHARACTER_AUTHZ_RESYNC_STALE_AFTER_MS`, 6h, `CHARACTER_AUTHZ_RESYNC_BATCH_SIZE` 25 per tick), over ESI's ~1h affiliation cache. Alliance *map* access already revokes through this same field in `canViewMap`, so intel scoping inherits the existing window rather than introducing a new one.

Scoping the reads also closes the `system-data` enumeration oracle for these two tables, since a sweep returns only rows the caller was already entitled to. The unchecked `systems` param itself stays as-is: what remains behind it is sov/FW/incursion intel and activity stats, which are public or near-public universe data. Accepted, not fixed here.

**Checkpoint caveat for the block:** Stage 3's `NOT NULL` scope columns break the structure/note create paths at runtime until Stages 4 and 6 wire them (the build stays green throughout). Acceptable on dev; run Stages 3 to 7 as one contiguous block rather than leaving the plan parked between them.

---

## Stage 3 — Owner columns on the intel tables

**Mode:** Execute
**Status:** todo
**Goal:** `ap_structure` and `ap_system_note` carry an owner entity mirroring `ap_map`, with every existing row backfilled so it keeps exactly the visibility it has today.
**References:** `src/db/schema/ap/map.md` (owner-triple precedent), `src/db/schema/ap/structure.md`, `src/db/schema/ap/instance.md`, `src/db/schema/ap/enums.md`
**Touches:** `src/db/schema/ap/enums.ts` (+ `.md`), `src/db/schema/ap/structure.ts` (+ `.md`), `src/db/schema/ap/system_note.ts` (+ `.md`, path as landed by #242), `src/db/migrations/0069_intel_scope.sql` + hand-written `.rollback.sql`.

**Spec:**
- New `pgEnum('intel_scope', ['private', 'corp', 'alliance'])`. Deliberately **not** a reuse of `map_type`: a future map type must not silently widen intel visibility.
- Both tables gain `scope intel_scope NOT NULL` plus the owner triple, matching `ap_map`'s column semantics exactly:
  - `owner_character_id` → FK `ap_character.id` `ON DELETE SET NULL`.
  - `owner_corporation_id`, `owner_alliance_id` → bare `bigint` (as on `ap_map`; `ap_corporation` / `ap_alliance` are not FK targets app-wide).
  - CHECK constraint: exactly one owner column non-null, and the populated one matches `scope`.
- A row with all three owner columns NULL (character erased on a `private` row) is **admin-only**, the same defensive default `canViewMap` applies to unowned maps. State the invariant in the schema companions.
- Add an index supporting the per-viewer visibility filter alongside the existing `system_id` index.
- **`ap_structure_event` / `ap_system_note_event` carry the same `scope` + owner triple, denormalized at write time.** The audit rows hold the full pre-delete snapshot in `payload`, so an unscoped read of the event table returns the exact intel the parent-table filter withholds. They cannot derive scope from the parent because on a delete the parent is gone, which is precisely the case the snapshot exists for. Both tables are write-only today (no read path exists), so this costs one column set now and is unfixable-in-place later once rows accumulate without it.
- **Backfill:** every pre-existing row takes the deployment's own owner from `ap_instance_owner` (`principal_kind` → `scope`, `principal_id` → the matching owner column). This preserves today's effective visibility: everyone inside the owning entity keeps seeing everything they see now. If `ap_instance_owner` holds exactly one row, use it; if it holds several, prefer the `alliance` row; if it is empty, **fail the migration loudly** rather than guessing an owner.
- Generate with `drizzle-kit generate`, then hand-write the `.rollback.sql` (drop columns, then the enum).
- Migration number assumes #242's `0068` is merged. Renumber on top of whatever `dev`'s chain actually ends at.

**Done when:**
- `pnpm db:migrate` applies cleanly against a dev DB that already has #242's `0068`.
- Every pre-existing `ap_structure` / `ap_system_note` row has exactly one owner column populated and a matching `scope`.
- The CHECK rejects an insert with zero or with two owner columns set.
- The rollback file cleanly reverses the migration.
- `pnpm lint && pnpm typecheck && pnpm build` green.

---

## Stage 4 — Scope-derived structure writes

**Mode:** Execute
**Status:** todo
**Goal:** Every structure write is gated by the row's scope: a create derives it from a map the caller can view, an edit or delete admits only callers it admits.
**References:** `src/lib/structures/mutations.md`, `guard.md`, `src/lib/auth/rights.md`, `src/app/api/map/README.md`
**Touches:** `src/lib/structures/guard.ts` (+ `.md`), `mutations.ts` (+ `.md`), `src/app/api/structures/route.ts` (+ `.md`), `src/app/api/structures/[structureId]/route.ts` (+ `.md`).

**Spec:**
- `POST /api/structures` body gains `mapId`. The route guards `requireMapView(mapId, session)` and derives `scope` + owner from that map's `type` and owner columns, populating Stage 3's columns on the insert. A create naming a map the caller cannot view is rejected.
- `requireStructureMutate` becomes row-scoped: PATCH/DELETE load the target row first and admit only a caller its scope admits (`private` matching `owner_character_id`, `corp` matching the caller's `corporation_id`, `alliance` matching the caller's `alliance_id`; `authz_level='admin'` passes everything, consistent with `canViewMap`). This replaces the any-authenticated-session check.
- A mutation on a row outside the caller's scope returns **404, not 403** — a 403 confirms the row exists and reintroduces the id oracle.
- `ap_structure_event` writes keep the same transaction and the same pre-delete snapshot, and additionally stamp the row's `scope` + owner (Stage 3). Any future read of the event table — a recovery UI, an admin audit view — must filter on it. There is no read path today; do not add one here.
- Vandalism *inside* a scope stays possible by design. Everyone who can see a row can correct it, because the corp that first logged a structure is usually not the corp that later finds it unanchored, and a creator-only write gate would rot the data. The audit log remains the accountability mechanism there.

**Done when:**
- A structure create through the mutation helper against the dev DB inserts a row satisfying Stage 3's CHECK (exactly one owner column, matching `scope`). The full behavioural matrix (cross-scope 404, non-viewable `mapId` rejected, same-scope CRUD unchanged) is locked by Stage 9's tests.
- `pnpm lint && pnpm typecheck && pnpm build` green.

---

## Stage 5 — Scope-aware structure reads

**Mode:** Execute
**Status:** todo
**Goal:** A structure row is readable only by characters its scope admits.
**References:** `src/lib/structures/read.md`, `src/lib/auth/rights.md`
**Touches:** `src/lib/structures/read.ts` (+ `.md`) and the two `structuresForSystems` callers (`src/app/(app)/map/[[...slug]]/page.tsx`, `src/app/api/map/[mapId]/system-data/route.ts`) (+ companions).

**Spec:**
- `structuresForSystems` takes the viewer alongside the system ids — a required parameter, so the type checker forces every caller through the filter — and filters to rows the viewer admits: `private` matching `owner_character_id`, `corp` matching the viewer's `corporation_id`, `alliance` matching the viewer's `alliance_id`. `authz_level='admin'` sees all, consistent with `canViewMap`.
- Both callers thread the session's viewer through; this closes the `system-data` sweep for structures (a 256-id request returns only admitted rows).

**Done when:**
- The viewer parameter is required on `structuresForSystems`, so `pnpm typecheck` fails on any caller not passing it. The behavioural filter (org B never sees org A's rows, including via the `system-data` sweep) is locked by Stage 9's tests.
- `pnpm lint && pnpm typecheck && pnpm build` green.

---

## Stage 6 — Scope-derived system-note writes

**Mode:** Execute
**Status:** todo
**Goal:** Every system-note write is gated by the row's scope, mirroring Stage 4.
**References:** the note mutation / route companions as landed by #242, plus `src/lib/structures/guard.md` and `mutations.md` for the Stage 4 shape to mirror.
**Touches:** the `ap_system_note` mutation module and write routes as merged by #242 (+ companions). Confirm the exact paths against merged `dev` before starting.

**Spec:**
- Mirror Stage 4 exactly: `mapId` on create with a `requireMapView` guard deriving `scope` + owner (populating Stage 3's columns), row-scoped mutate guard, 404 on cross-scope PATCH/DELETE.
- Per-note lock behaviour (409 on a locked row) is unchanged and composes with the scope check: scope is evaluated first, so a locked row outside the caller's scope 404s rather than 409ing.
- `ap_system_note_event` writes stamp the row's `scope` + owner the same way, with the same rule: no read path today, and any added later filters on it.

**Done when:**
- A note create through the mutation helper against the dev DB inserts a row satisfying Stage 3's CHECK. The behavioural matrix (cross-scope 404, locked in-scope row still 409s, same-scope CRUD unchanged) is locked by Stage 9's tests.
- `pnpm lint && pnpm typecheck && pnpm build` green.

---

## Stage 7 — Scope-aware system-note reads

**Mode:** Execute
**Status:** todo
**Goal:** A system note is readable only by characters its scope admits, including through the deployment-wide notes browser.
**References:** the note read module / browser route companions as landed by #242, plus `src/lib/structures/read.md` for the Stage 5 shape to mirror.
**Touches:** the `ap_system_note` read module, the notes-browser route, and the map-node indicator data source as merged by #242 (+ companions). Confirm the exact paths against merged `dev` before starting.

**Spec:**
- Mirror Stage 5: the read module takes a required viewer and filters to admitted rows; `authz_level='admin'` sees all.
- The **notes browser** search is the sharpest read surface (deployment-wide ILIKE over every note body, no map indirection at all) and must apply the viewer filter before the 50-row cap, not after — filtering after the cap would silently return short pages.
- The map-node note indicator pill counts only notes the viewer can see, so a system carrying nothing but other orgs' notes shows no pill.

**Done when:**
- The viewer parameter is required on the note read module, so `pnpm typecheck` fails on any caller not passing it. The behavioural filter, including the filter-before-cap property of the browser search, is locked by Stage 9's tests.
- `pnpm lint && pnpm typecheck && pnpm build` green.

---

## Stage 8 — Surface the scope in the UI

**Mode:** Execute
**Status:** todo
**Goal:** A viewer can tell at a glance who else can see each row, and who will see a new one before they submit it.
**References:** the structures panel and system-notes panel companions, `src/db/schema/ap/enums.md` (`intel_scope`)
**Touches:** the structures sidebar panel component, the system-notes panel and its add/edit dialog (+ companions).

**Spec:**
- Each row renders its scope (private / corp / alliance, naming the entity where one applies).
- The add/edit dialog names the audience the row will land in, derived from the current map, **before** submit. The failure mode being designed against is a user writing staging intel believing it is private.
- No scope picker: scope is derived from the map, not chosen. A row cannot be moved between scopes from this UI.

**Done when:** `pnpm typecheck && pnpm build` green. (The visual checks — chips render, dialog names the audience — are batched in Manual verification.)

---

## Stage 9 — Cross-scope regression tests

**Mode:** Execute
**Status:** todo
**Goal:** Lock the P1 invariants so a future read path or create route cannot silently reintroduce global visibility.
**References:** the Stage 2 spec (same shape and suite conventions), `src/lib/structures/read.md`, the note read companion
**Touches:** new spec(s) under `tests/integration/`.

**Spec:**
- DB-backed, `RUN_DB_TESTS`-guarded, snapshot/restore per the suite convention.
- Build two orgs and, for both `ap_structure` and `ap_system_note`, assert: a read as org B omits org A's rows; a PATCH/DELETE of org A's row as org B 404s and writes nothing; a create naming a non-viewable map is rejected; same-scope CRUD succeeds.
- Cover the notes browser search specifically, including that a capped result page contains only admitted rows.
- Cover the `system-data` sweep: 256 arbitrary system ids as org B returns none of org A's rows.
- Suite caveats: the dev DB is non-pristine, so snapshot and restore; triage failures in isolation because the full suite is parallel-flaky.

**Done when:** each assertion fails if the corresponding Stage 4–7 guard or filter is removed. `RUN_DB_TESTS=1 pnpm test <spec>` green.

---

## The P2 defect (Stages 10 to 12)

The SharedWorker holds one WebSocket per browser origin and subscribes it to the union of every map any tab has open. `broadcast()` then posts every inbound envelope to every tab. The per-map consumers (`MapCanvas`, `MapPresenceContext`, `MapUnderglowBridge`, `ConnectionMassLog`) filter on `envelope.task` but not on which map an envelope belongs to, so a second map open in another tab applies the first map's `system.added` / `system.updated` / `connection.create` / `characterUpdate` / `systemNotification` events to its own local state.

This is display/local-state corruption only: mutations go through per-map API routes and are unaffected, a reload resyncs, and server authorization is not bypassed (the socket only subscribes to maps the session can `canViewMap`). The fix routes envelopes to only the tabs that subscribed to their map, which requires every map-scoped envelope to carry its source `mapId` on the wire (today only `mapUpdate` does, inside `load`).

---

## Stage 10 — Tag every realtime envelope with its source map

**Mode:** Execute
**Status:** done — 241125a3
**Goal:** Every map-scoped envelope crossing the wire carries an envelope-level `mapId`; control-plane frames (`healthCheck`, connection `status`) carry none.
**References:** `src/lib/realtime/protocol.md`, `bus.md`, `wsServer.md`; `tests/unit/realtime-delivery.md`
**Touches:** `src/lib/realtime/protocol.ts` (+ `.md` if the contract description changes), `src/lib/realtime/bus.ts` (+ `bus.md`).

**Spec:**
- In `protocol.ts`:
  - `envelopeSchema` gains `mapId: z.number().int().positive().optional()`. Load-bearing: `z.object()` strips unknown keys, so without adding it here the field is dropped when the SharedWorker runs `envelopeSchema.safeParse` and never reaches the router.
  - `serverToClientMessageSchema` (the per-task discriminated union) must also allow the field so `ServerToClientMessage` can carry it. Add `mapId` to the shared `message(task, load)` factory output (or each member) so bus-built messages type-check and serialize with it.
  - Keep `mapUpdateLoadSchema.mapId` as-is (redundant with the envelope field but harmless; `MapCanvas` reads `load` for other fields).
- In `bus.ts` `dispatch()`, attach `mapId: Number(mapId)` to every `message` it builds: the four task-tagged branches (`characterUpdate`, `characterLogout`, `systemNotification`, `connectionMassLog`) and the fall-through `mapUpdate` branch. The value is already in scope.
- `wsServer.ts` needs no change if it stringifies the `ServerToClientMessage` verbatim; confirm it does not reshape the message and drop the new field. Its own `healthCheck` heartbeat stays `mapId`-less by construction.

**Done when:**
- Existing bus/realtime tests are extended to assert: a `characterUpdate` / `systemNotification` / `connectionMassLog` / `mapUpdate` envelope carries a top-level `mapId` equal to its source `map:<id>` channel, and a `healthCheck` frame carries none.
- `pnpm typecheck` green; the extended tests pass.

---

## Stage 11 — Route per-port in the SharedWorker

**Mode:** Execute
**Status:** done — 198cb20d
**Goal:** The worker delivers a map-scoped envelope only to the tabs subscribed to that map; control-plane frames still reach all tabs.
**References:** `src/lib/realtime/sharedWorker.md`, `protocol.md` (as updated by Stage 10), `useRealtime.md`; `tests/unit/realtime-delivery.md`, `realtime-reconnect.md`
**Touches:** `src/lib/realtime/sharedWorker.ts` (+ `sharedWorker.md`).

**Spec:**
- Change the subscription registry from a refcount to a per-map port set: `subscriptions: Map<number, Set<MessagePort>>` (replaces `Map<number, number>`).
- `handlePortMessage` must receive the originating port. Wire it as `port.onmessage = (e) => handlePortMessage(port, e.data)`.
- `addSubscription(port, mapId)`: add the port to the map's set (creating it if absent); when the set was empty, `connect()` and send the `subscribe` frame (the server-facing refcount is now "set became non-empty").
- `removeSubscription(port, mapId)`: remove the port; when the set empties, delete it and send the `unsubscribe` frame.
- Inbound routing (`ws.onmessage`): after `envelopeSchema` parse, branch on the envelope's `mapId`:
  - `typeof envelope.mapId === 'number'` → post only to `subscriptions.get(envelope.mapId)` (no-op if absent/empty).
  - otherwise (control-plane, no `mapId`) → `broadcast()` to all ports as today.
- `activeMapIds()` stays `[...subscriptions.keys()]`; the reconnect replay (`sendFrame('subscribe', activeMapIds())`) is unchanged.
- Connection `status` transitions and the `broadcast()` helper for them are unchanged (status always goes to all ports). The `ports` set is still needed (control-plane fan-out, status, eager connect).

**Note (pre-existing, out of scope):** a tab that closes without unsubscribing leaves its port lingering in the sets, keeping that map subscribed on the server. This leak already exists with the refcount; posting to a dead port is a harmless no-op. Port-close cleanup is later hardening; do not expand scope here.

**Done when:** `tests/unit/realtime-delivery.test.tsx` extended so a `mapId`-tagged envelope reaches only a matching subscriber and a control-plane frame reaches all ports. `pnpm lint && pnpm typecheck && pnpm build` green. (The two-tab isolation, heartbeat fan-out, and single-tab checks need a browser and are batched in Manual verification.)

---

## Stage 12 — Client defense-in-depth

**Mode:** Execute
**Status:** done — 27267011, d9a18ee7
**Goal:** Belt-and-suspenders guard so a future routing regression cannot silently corrupt a canvas.
**References:** `src/components/map/MapCanvas.md`, `MapUnderglowBridge.md`, `MapPresenceContext.md`; `src/components/sidebar/ConnectionMassLog.md`; `src/lib/realtime/protocol.md`
**Touches:** `src/components/map/MapCanvas.tsx` (+ `.md`) and every other map-scoped consumer whose envelope now carries `mapId`.

**Spec:**
- In the `MapCanvas` realtime handler, after the `task` check, drop envelopes whose `mapId` is present and not equal to `data.map.id`. In normal operation the guard is a no-op — Stage 11 already prevents foreign delivery.
- `MapUnderglowBridge`, `ConnectionMassLog` and `MapPresenceContext` take the same guard. All four compare the **envelope-level** `mapId` from Stage 10, which every map-scoped task carries, so a consumer whose `load` has no `mapId` of its own (presence) is guardable on the same terms as one whose load does.

**Done when:** the mismatched-`mapId` drop is in place in every map-scoped consumer and `pnpm typecheck && pnpm build` stay green.

---

## Manual verification

_(worked by the user once, after the run — the plan is not complete until it passes. Everything a machine can check lives in a stage's **Done when**, not here.)_

- **Stage 1** — one cross-tenant create attempt through the running app (a signature naming another map's system id) is rejected with no row written. Stage 2's tests cover the helper-level reject/success matrix; this confirms the route wiring end to end.
- **Stage 1** — the one create path that reaches `createConnection` indirectly still works on a same-map operation: stargate auto-link when adding a system (`addSystemWithStargateLinks`). Stage 2's tests cover the direct create paths but not this one, and a false rejection here would look like a broken map rather than a security error.
- **Stage 3** — after the backfill, confirm the existing deployment's members still see every structure and note they saw before the migration. A row going missing means the backfill picked the wrong owner entity.
- **Stage 5** — the structures panel still populates on both the server-rendered map page and the live `system-data` backfill.
- **Stage 7** — the map-node note pill counts only notes you can see: a system carrying nothing but another org's notes shows no pill.
- **Stage 8** — two characters in different corps, each on their own corp map, both looking at the same system: confirm each sees only their own corp's structures and notes, that the scope chips name the right entity, and that the add dialog names the right audience before submit.
- **Stage 11** — reproduce the original report. Two corp maps side by side in two windows; scan, add and move systems on map A; map B stays clean across systems, connections, presence roster, and kill/ping underglow. No "System not found" toast on the secondary map, no phantom nodes, nothing to clean up on reload.
- **Stage 11** — the degraded banner still clears on the `healthCheck` heartbeat in **both** tabs. This is the one that catches an over-tight fix: routing map-scoped envelopes per-port must not also strand the control-plane fan-out.
- **Stage 11** — a single tab on a single map behaves exactly as before.
- **Stage 12** — the guard is invisible in normal operation. Nothing disappears from a canvas that should be there, and the presence roster still fills on the map you have open.

---

## Further hardening (not scheduled)

These surfaced during the audit but are not part of this plan; each needs its own design pass.

- **Presence lifecycle audit.** `loadMapPresence` filters `status='active'` as defense-in-depth, but view-access revocation on corp/alliance departure depends on the tracking-row prune plus `characterLogout`. Presence exposes live pilot location, so confirm the prune path is airtight and cannot leave a stale tracking row visible to a former member.
- **Alt-to-main disclosure through the audit actor list.** `listAuditActors` rolls every actor up to their account main and renders it as "Alt (main: Main)", and the actor filter matches every character in that account. The events themselves are correctly map-scoped and gated on `audit_view`, but the linkage they expose is account-global: anyone holding `audit_view` on a map learns the alt-to-main mapping of every character who has ever committed to it. On a single-alliance deployment that rollup is the feature. On FFA it is harvestable — stand up a map, draw people onto it via a role grant or a shared chain, and collect alt-to-main mappings that are high-value intel independently of anything charted on the map. Decide whether the rollup should degrade to bare character names for actors outside the viewer's own corp/alliance.
- **`map_update` policy for public instances.** Content editing resolves to view authority ("every viewer can chart"), which is right for a trusted corp but widens the blast radius of any content bug on a public FFA instance. Decide whether public maps want a viewer/editor split.
- **Promoting an intel row's scope.** A note or structure written on a private map is invisible to the writer's corp forever. Visibility follows the viewer, so the writer still gets their own notes back on any map, but sharing them upward needs an explicit "promote to corp" action. Deferred as a bonus feature, not a launch blocker.
- **Webhook URL host allowlist (SSRF).** `ap_map_webhook.url` is validated only as a well-formed URL (`z.string().url().max(2000)` in `actions/webhooks.ts`); there is no host restriction. The dispatcher POSTs the payload and records `last_status` plus a truncated `last_error` per attempt, which the admin UI surfaces — so a webhook aimed at a cloud metadata endpoint or a localhost service is a request forgery with a response oracle attached. Today only trusted directors configure webhooks. Under FFA, Director in *any* corp is enough, and founding a corp is trivial, so this becomes reachable by any user who wants it. The channel enum is already `discord`/`slack`, which makes a host allowlist the cheap fix.
- **Rate limiting on the expensive read surfaces.** Confirm what exists (nothing was found during this audit). Two endpoints stand out under untrusted-but-authenticated load: #242's notes browser runs an unanchored `ILIKE '%term%'` over every note body, which no ordinary index serves, and `system-data` accepts 256 system ids per call. Both are cheap to invoke and expensive to serve.
- **Per-user caps on intel rows.** Map creation is already bounded by `MAX_MAPS_PER_SCOPE` (private 3 / corp 1 / alliance 1), but nothing caps how many structures or notes one character can write. Individual bodies are length-capped; the row count is not. On FFA that is both a storage vector and an amplifier for the ILIKE scan above.
- **Aperture as an ESI proxy.** The structure-owner picker drives ESI corp search on the caller's behalf, and killmail enrichment shares one app-wide token bucket. Under FFA any user can spend the deployment's ESI budget, and one tenant's usage degrades every other tenant. Belongs with the broader shared-fate resource work rather than here, but it enters through a user-facing feature so it is easy to miss.
- **Keep #242's notes out of the public snapshot.** `PublicMapViewData` has no `notes`, `intel`, or `structures` field *by construction*, and the discriminated presence union makes "no character name outside `full`" a compile-time property. That is a deliberate design worth preserving: confirm the note feature did not add a field or a `showNotes` redaction-profile flag, and that if one is ever added it carries the Stage 3 scope check rather than the map's share settings alone.
- **Authz resync throughput at FFA scale.** Intel-scope revocation, alliance map access, and the presence prune above all key off `ap_character.alliance_id` freshness. The resync sweeps 25 characters per tick against a 6h staleness threshold, which is sized for a single-alliance deployment. On a public instance with thousands of characters that batch may not keep up, stretching the window in which a departed corp still reads its former alliance's intel. Measure before FFA launch and resize the batch, not the model.

## Notes
_(appended by executing sessions — non-obvious findings only)_

- **Swept and found sound during planning; do not re-audit without a reason.** `ap_map_webhook` is map-scoped with an FK cascade and `ap_webhook_channel` is an enum, not a shared registry (the URL host is the open question, above — the tenancy is not). `ap_integration_token.corporation_id` is already the enforced tenant boundary for every integration route. `ap_character_role` is written only by `syncCharacterAuthz` from ESI titles, so there is no self-assignment escalation path onto another map's role grant. `ap_system_stats` is per `(system, hour)` public universe data. `listViewableMaps` filters server-side via `viewableMapPredicate`; `listAdminMaps` is unscoped but global-admin-only by design. The audit route takes its map id from the guard result (`{ mapId: guard.mapId }`) rather than the URL param, which is the idiom Stage 1 is adding elsewhere.
- **Plan reconciliation.** The P0 and P2 blocks were executed against an earlier revision of this file that had not yet been expanded with the P1 intel-scoping block, and which numbered the realtime stages 3 to 5. The two revisions were reconciled onto this numbering before merge; the recorded shas are the live post-rebase ones. The five recorded Status shas on the executed revision were pre-rebase and pointed at commits unreachable from the branch.
- **Stage 1** — `restoreConnection.ts` does not call `createConnection`; it re-confirms the dormant row via its own direct `commitMapEvent` call (`kind: 'connection.create'`, reusing the event kind but not the helper). It is therefore untouched by the Stage 1 asserts and needs no manual check.
- **Stage 1** — `pasteSignatures`' add branch never sets `mapConnectionId` on the `CreateSignatureInput` it builds (the field is simply omitted, so it's `undefined`, not `null`). The spec's `input.mapConnectionId != null` guard (loose inequality) treats `undefined` the same as `null` and correctly skips `assertConnectionOnMap` in that case — a strict `!== null` check would NOT have.
- **Stage 1** — the update-path holes (`updateSignature`'s unchecked `mapConnectionId`, and `pasteSignatures` reading a foreign system's sigs before any tenancy check) were found only after Stage 2's suite existed, and landed as one commit carrying both the asserts and their regression tests. The `pasteSignatures` one is subtle: with `updateExisting` off, an incoming code already present on the foreign system short-circuits the loop so no downstream helper ever runs, and the call returns `ok` — relying on a helper to throw is not a tenancy check.
- **Stage 2** — verified the spec's regression value directly: with `assertSystemOnMap` temporarily stubbed to a no-op, exactly the 3 create rejection cases fail (`createSignature`, `createConnection`, `pasteSignatures` add branch) while the 3 same-map acceptance cases still pass, as expected. Restored and reran green before finishing.
- **Stage 2** — used universe fixture id range `98046xxx` (region/constellation/category/group/type/systems); grepped `tests/integration/*.test.ts` first to confirm the range wasn't already claimed (existing suites occupy 98040xxx through 98045xxx).
- **Stage 10** — `wsServer.ts`'s `send()` does `JSON.stringify(message)` verbatim with no reshaping, confirming the spec's assumption; it needed no change and its companion needed no edit. The connect-time and heartbeat `healthCheck` frames it builds directly are unaffected and stay `mapId`-less by construction.
- **Stage 10** — `mapAccess`, `mapConnectionAccess`, `mapDeleted`, `logData` are still forward-declared/unproduced (only `publicUpdate` is built directly in `wsServer.ts`, outside `bus.dispatch()`); none are emitted by `bus.ts`, so the spec's four task-tagged branches plus the `mapUpdate` fall-through are the complete set of `bus.dispatch()` outputs and all now carry envelope-level `mapId`.
- **Stage 10** — `tests/integration/realtime-transport.test.ts` had no companion `.md`; created one per the standing instruction while extending the file with two assertions. The `healthCheck` test had to construct the `WebSocket` directly and attach the `message` listener before `open()`'s promise resolves — the server's `connection` handler sends `healthCheck` immediately, and it can race the `open()` test helper's own `'open'` listener, causing an intermittent `no message within 500ms` timeout when the listener was attached after `await open(...)` returned.
- **Stage 11** — `tests/unit/realtime-delivery.test.tsx`'s existing harness (`FakeSharedWorker`/`FakePort`) only exercises `useRealtime.tsx`'s client-side provider — the SharedWorker itself is stubbed out entirely, so it can't observe the worker's internal per-port routing. Proving the routing logic required a second, independent describe block in the same file that imports `sharedWorker.ts` directly (`vi.resetModules()` + a fresh dynamic `import()` per test) against a faked `self` (captures the `connect` listener the module registers at import time) and a faked `WebSocket` (its constructed instance is recovered from a `static instances: FakeWebSocket[]` list, not via `this`-aliasing in the constructor — the repo's `@typescript-eslint/no-this-alias` flags even a plain `outerVar = this;` assignment expression, not just declarations). `noUncheckedIndexedAccess` is on, so post-`toHaveLength(1)` array indexing needs a `!` — TS doesn't narrow array length from a vitest matcher.
- **Stage 12** — `MapUnderglowBridge` had no `mapId` prop before this stage (only `systems`), so guarding it required adding one, threaded from `MapCanvas` as `data.map.id`. `MapPresenceContext` needed the same new prop. `ConnectionMassLog` already took `mapId: string` for its own fetch/GET scoping, so its guard was a drop-in addition.
- **Stage 12** — `systemNotificationLoadSchema`'s per-kind body (`killmail`/`ping`) carries its own `mapId` field, independent of the Stage 10 envelope-level one. `MapUnderglowBridge`'s guard checks the envelope-level field (before the `safeParse`) for consistency with the other consumers rather than the load's own field, but either would work there.
- **Stage 12** — `AppUpdateBanner` (the only other raw `envelope.task` consumer found via a repo-wide grep) filters on `task === 'healthCheck'`, a control-plane frame with no `mapId` by construction — correctly out of scope for this stage.
