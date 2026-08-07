# Multitenant Security Hardening

**Goal:** Close the cross-tenant data-isolation gaps before the public FFA deployment, in priority order: server-side write isolation (a real authorization leak) first, then client-side realtime routing (cross-tab display bleed).

**References:** CLAUDE.md "Mutation pathways", "Realtime", "Database" (real FKs across boundaries). `src/lib/auth/rights.md` — the actor-authorization gate (`canViewMap` / `canMutateMap` / `requireMapRight`), correct as it stands and not where either defect lives; it is the backdrop for the whole threat model. `src/app/api/map/README.md` — the JSON API mutation contract. Per-stage references below carry the rest.

---

## Threat model

Intel charted in Aperture (scanned signatures, connection chains, pilot presence) is operationally sensitive. A cross-map or cross-user leak during a PvP engagement or a wormhole siege exposes a defender's chain to the attacker, or lets an attacker corrupt it. On a public FFA deployment the precondition for an attack is only a valid login: `canCreateMap` lets any active character create a private map, on which they hold `map_update`. Any authenticated user can therefore pivot from a throwaway map they own to any other map.

## Priority ordering

- **P0 (Stages 1 to 2):** server-side cross-tenant write. An authenticated user can inject rows onto a map they cannot see. This is a true authorization leak.
- **P2 (Stages 3 to 5):** cross-tab realtime bleed inside one authorized browser. Display/local-state corruption only; server authorization is not bypassed and a reload clears it.

---

## The P0 defect (Stages 1 to 2)

The actor-authorization gate (`requireMapMutate(urlMap, session, 'map_update')`) runs correctly on every route. The gap is a second, orthogonal check that is missing on the **create** paths: whether the child row named in the request body actually belongs to the map the caller is authorized on.

The read side already defends this. `GET /api/map/[mapId]/systems/[systemId]/signatures` verifies the system belongs to the guarded map, with a comment naming the exact threat ("a viewer of map A could harvest signatures from a system on map B by id"). The update/delete mutation helpers do the same via `apMapSystem.mapId == input.mapId`. The create helpers do not:

- `createSignature` (`signatures.ts`) inserts on the body's `mapSystemId` (and optional `mapConnectionId`) with no ownership check. Both `ap_map_system.id` and `ap_map_signature.id` are `bigserial`, so ids are sequential and enumerable. Result: an authenticated user can inject a fabricated signature onto another map's system (false statics / K162s during a siege), which surfaces on the victim's map on next load.
- `createConnection` (`connections.ts`) inserts `sourceMapSystemId` / `targetMapSystemId` unchecked. Lower blast radius (the new row is stamped with the caller's own `map_id`, so it does not render on the victim's map), but it pollutes the caller's map with cross-map references and acts as a global id existence oracle.
- `pasteSignatures` (`bulkSignatures.ts`) reaches `createSignature` for its add branch, so it inherits the injection; its update/delete branches route through the guarded helpers and already abort on a foreign child.

The fix is one shared check reused by the create paths: **does this child belong to the authorized map**, not "is this person allowed on this map" (that already runs).

---

## Stage 1 — Tenancy-binding assertion on the create paths

**Mode:** Execute
**Status:** done — 0af91534
**Goal:** A create mutation can only attach a child to systems/connections that live on the same map the caller is authorized on. Naming a foreign `ap_map_system.id` / `ap_map_connection.id` is rejected and rolls the transaction back.
**References:** `src/lib/map/mutations/core.md`, `signatures.md`, `connections.md`, `bulkSignatures.md`, `systems.md`; `src/lib/auth/rights.md`; `src/app/api/map/README.md`.
**Touches:** new `src/lib/map/mutations/tenancy.ts` (+ `.md`); `src/lib/map/mutations/signatures.ts` (+ `.md`); `src/lib/map/mutations/connections.ts` (+ `.md`).

**Spec:**
- New module `tenancy.ts`, no `import 'server-only'` (mirror `core.ts`: it is reachable from worker-run mutation helpers), exporting two `tx`-scoped asserts:
  - `assertSystemOnMap(tx: Tx, mapSystemId: bigint, mapId: bigint): Promise<void>` — `SELECT id FROM ap_map_system WHERE id = mapSystemId AND map_id = mapId`; throw `Error('System does not belong to this map.')` when absent.
  - `assertConnectionOnMap(tx: Tx, connectionId: bigint, mapId: bigint): Promise<void>` — same shape against `ap_map_connection`; throw `Error('Connection does not belong to this map.')`.
  - Import `Tx` from `./core`.
- `createSignature.mutate`: before the insert, `await assertSystemOnMap(tx, input.mapSystemId, input.mapId)`; when `input.mapConnectionId != null`, also `await assertConnectionOnMap(tx, input.mapConnectionId, input.mapId)`.
- `createConnection.mutate`: before the insert, `await assertSystemOnMap(tx, input.sourceMapSystemId, input.mapId)` and the same for `input.targetMapSystemId`. Asserting both against `input.mapId` also guarantees the edge cannot span two maps, so no separate equality check is needed. This also closes the `createConnection` existence oracle.
- Bulk paste inherits the fix through `createSignature`; no change to `bulkSignatures.ts`.
- Error handling is already in place: a throw inside `mutate` rolls back the standalone transaction and surfaces as `{ ok: false, error }`, which the routes map to HTTP 400. In joined-tx callers the throw aborts the outer batch, which is the desired atomic behaviour.
- `addSystemWithStargateLinks` calls `createConnection` with neighbour ids it selected `WHERE map_id = input.mapId`, so the new asserts are satisfied (redundant but harmless). Confirm no false rejection on stargate auto-link and on the restore path.
- Companion updates: state the create-path invariant in present tense (e.g. `signatures.md` header note becomes "ownership is validated in create/update/delete"); document the two new `tenancy.ts` exports.

**Done when:** `pnpm lint && pnpm typecheck && pnpm build` green. The behavioural gates — a cross-tenant create rejected, a same-map create unaffected — are Stage 2's spec, which runs; do not hand-test what the next stage automates.

---

## Stage 2 — Cross-tenant write regression tests

**Mode:** Execute
**Status:** done — 75509ebb
**Goal:** Lock the Stage 1 invariant so a future create path cannot silently reintroduce the gap.
**References:** `src/lib/map/mutations/tenancy.md` (written by Stage 1), `signatures.md`, `connections.md`, `bulkSignatures.md`; `tests/integration/map-api-routes.md` for the suite's conventions.
**Touches:** new spec under `tests/integration/` (+ a note in `tests/unit/route-rights-coverage.test.ts` pointing at it).

**Spec:**
- Add a DB-backed integration test (guarded by `RUN_DB_TESTS`, snapshot/restore around any shared-state rows per the suite convention) that, for each create path (`createSignature`, `createConnection`, and the bulk-add branch of `pasteSignatures`), builds two maps and asserts a create naming the other map's child is rejected and writes nothing, while a same-map create succeeds.
- Add a short comment explaining why a pure static grep cannot guard this: the authz guard is present and correct on every route, so the only reliable signal is the behavioural attempt-and-reject.
- Suite caveats to respect: `RUN_DB_TESTS` runs against the non-pristine dev DB, so snapshot and restore any rows the test mutates; triage failures in isolation because the full suite is parallel-flaky.

**Done when:** the new spec fails if either Stage 1 assert is removed and passes with it in place. `RUN_DB_TESTS=1 pnpm test <spec>` green.

---

## The P2 defect (Stages 3 to 5)

The SharedWorker holds one WebSocket per browser origin and subscribes it to the union of every map any tab has open. `broadcast()` then posts every inbound envelope to every tab. The per-map consumers (`MapCanvas`, `MapPresenceContext`, `MapUnderglowBridge`, `ConnectionMassLog`) filter on `envelope.task` but not on which map an envelope belongs to, so a second map open in another tab applies the first map's `system.added` / `system.updated` / `connection.create` / `characterUpdate` / `systemNotification` events to its own local state.

This is display/local-state corruption only: mutations go through per-map API routes and are unaffected, a reload resyncs, and server authorization is not bypassed (the socket only subscribes to maps the session can `canViewMap`). The fix routes envelopes to only the tabs that subscribed to their map, which requires every map-scoped envelope to carry its source `mapId` on the wire (today only `mapUpdate` does, inside `load`).

---

## Stage 3 — Tag every realtime envelope with its source map

**Mode:** Execute
**Status:** todo
**Goal:** Every map-scoped envelope crossing the wire carries an envelope-level `mapId`; control-plane frames (`healthCheck`, connection `status`) carry none.
**References:** `src/lib/realtime/protocol.md`, `bus.md`, `wsServer.md`; `tests/unit/realtime-delivery.md`.
**Touches:** `src/lib/realtime/protocol.ts` (+ `.md` if the contract description changes), `src/lib/realtime/bus.ts` (+ `bus.md`).

**Spec:**
- In `protocol.ts`:
  - `envelopeSchema` gains `mapId: z.number().int().positive().optional()`. Load-bearing: `z.object()` strips unknown keys, so without adding it here the field is dropped when the SharedWorker runs `envelopeSchema.safeParse` and never reaches the router.
  - `serverToClientMessageSchema` (the per-task discriminated union) must also allow the field so `ServerToClientMessage` can carry it. Add `mapId` to the shared `message(task, load)` factory output (or each member) so bus-built messages type-check and serialize with it.
  - Keep `mapUpdateLoadSchema.mapId` as-is (redundant with the envelope field but harmless; `MapCanvas` reads `load` for other fields).
- In `bus.ts` `dispatch()`, attach `mapId: Number(mapId)` to every `message` it builds: the four task-tagged branches (`characterUpdate`, `characterLogout`, `systemNotification`, `connectionMassLog`) and the fall-through `mapUpdate` branch. The value is already in scope.
- `wsServer.ts` needs no change if it stringifies the `ServerToClientMessage` verbatim; confirm it does not reshape the message and drop the new field. Its own `healthCheck` heartbeat stays `mapId`-less by construction.

**Done when:**
- A `characterUpdate` / `systemNotification` / `connectionMassLog` / `mapUpdate` envelope on the wire has a top-level `mapId` equal to its source `map:<id>` channel.
- `healthCheck` frames have no `mapId`.
- `pnpm typecheck` green; existing bus/realtime tests updated to assert the new field and still pass.

---

## Stage 4 — Route per-port in the SharedWorker

**Mode:** Execute
**Status:** todo
**Goal:** The worker delivers a map-scoped envelope only to the tabs subscribed to that map; control-plane frames still reach all tabs.
**References:** `src/lib/realtime/sharedWorker.md`, `protocol.md`, `useRealtime.md`; `tests/unit/realtime-delivery.md`, `realtime-reconnect.md`.
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

**Done when:** `tests/unit/realtime-delivery.test.tsx` extended so a `mapId`-tagged envelope reaches only a matching subscriber and a control-plane frame reaches all ports. `pnpm lint && pnpm typecheck && pnpm build` green. The routing logic is testable and belongs here; whether the defect is actually gone is a browser observation, and it sits in **Manual verification**.

---

## Stage 5 — (optional) Client defense-in-depth

**Mode:** Execute
**Status:** todo
**Goal:** Belt-and-suspenders guard so a future routing regression cannot silently corrupt a canvas.
**References:** `src/components/map/MapCanvas.md`, `MapUnderglowBridge.md`, `MapPresenceContext.md`; `src/components/sidebar/ConnectionMassLog.md`; `src/lib/realtime/protocol.md`.
**Touches:** `src/components/map/MapCanvas.tsx` (+ `.md`) and any other map-scoped consumer whose envelope now carries `mapId`.

**Spec:**
- In the `MapCanvas` realtime handler, after the `task` check, drop envelopes whose `mapId` is present and not equal to `data.map.id`.
- `MapUnderglowBridge` / `ConnectionMassLog` may add the same guard.
- `MapPresenceContext` cannot be guarded this way from `load` alone (the `characterUpdate` load has no `mapId`); it relies entirely on Stage 4 routing. Note this in its companion rather than adding a broken guard.

**Done when:** the guard is a no-op in normal operation (Stage 4 already prevents foreign delivery) and `pnpm typecheck` / `build` stay green. Skippable if the worker fix is deemed sufficient.

---

## Manual verification

_(worked by the user once, after the run — the plan is not complete until it passes. Everything a machine can check lives in a stage's **Done when**, not here.)_

- **Stage 1** — the one create path that reaches `createConnection` indirectly still works on a same-map operation: stargate auto-link when adding a system (`addSystemWithStargateLinks`). Stage 2's spec covers the direct create paths but not this one, and a false rejection here would look like a broken map rather than a security error. (Connection restore does not route through `createConnection` — it re-confirms the dormant row via its own `commitMapEvent` call — so it is unaffected by this stage and needs no check here.)
- **Stage 4** — reproduce the original report. Two corp maps side by side in two windows; scan, add and move systems on map A; map B stays clean across systems, connections, presence roster, and kill/ping underglow. No "System not found" toast on the secondary map, no phantom nodes, nothing to clean up on reload.
- **Stage 4** — the degraded banner still clears on the `healthCheck` heartbeat in **both** tabs. This is the one that catches an over-tight fix: routing map-scoped envelopes per-port must not also strand the control-plane fan-out.
- **Stage 4** — a single tab on a single map behaves exactly as before.
- **Stage 5** (if built) — the guard is invisible in normal operation. Nothing disappears from a canvas that should be there.

---

## Notes

_(appended by executing sessions — non-obvious findings only)_

- **Stage 1** — `restoreConnection.ts` does not call `createConnection`; it re-confirms the dormant row via its own direct `commitMapEvent` call (`kind: 'connection.create'`, reusing the event kind but not the helper). It is therefore untouched by the Stage 1 assert and was removed from the Stage 1 manual-verification bullet, which had incorrectly listed it as a second indirect caller alongside `addSystemWithStargateLinks`.
- **Stage 1** — `pasteSignatures`' add branch never sets `mapConnectionId` on the `CreateSignatureInput` it builds (the field is simply omitted, so it's `undefined`, not `null`). The spec's `input.mapConnectionId != null` guard (loose inequality) treats `undefined` the same as `null` and correctly skips `assertConnectionOnMap` in that case — a strict `!== null` check would NOT have.
- **Stage 2** — verified the new spec's regression value directly: with `assertSystemOnMap` temporarily stubbed to a no-op, exactly the 3 rejection cases fail (`createSignature`, `createConnection`, `pasteSignatures` add branch) while the 3 same-map acceptance cases still pass, as expected. Restored and reran green before finishing. `assertConnectionOnMap` isn't independently exercised by this spec since none of the three create paths reachable here set `mapConnectionId` on the fixture rows — `pasteSignatures`' add branch never does (see the Stage 1 note above), so its coverage is already the strict subset of what Stage 1 wired.
- **Stage 2** — used universe fixture id range `98046xxx` (region/constellation/category/group/type/systems) — grepped `tests/integration/*.test.ts` first to confirm the range wasn't already claimed (existing suites occupy 98040xxx through 98045xxx).

---

## Further hardening (not scheduled)

These surfaced during the audit but are not part of this plan; each needs its own design pass.

- **Presence lifecycle audit.** `loadMapPresence` filters `status='active'` as defense-in-depth, but view-access revocation on corp/alliance departure depends on the tracking-row prune plus `characterLogout`. Presence exposes live pilot location, so confirm the prune path is airtight and cannot leave a stale tracking row visible to a former member.
- **`map_update` policy for public instances.** Content editing resolves to view authority ("every viewer can chart"), which is right for a trusted corp but widens the blast radius of any content bug on a public FFA instance. Decide whether public maps want a viewer/editor split.
