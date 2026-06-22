# `/api/map` — Map Mutation Pathways

This directory implements the **high-frequency JSON API** half of the canonical mutation pathway (CLAUDE.md §"Mutation pathways"). The low-frequency half lives in `src/app/(app)/actions/map.ts` (Server Actions).

## Design contract

Every route in this tree obeys these invariants:

1. **One `ap_map_event` per call.** Every mutation is routed through `commitMapEvent` (in `src/lib/map/mutations/core.ts`), which opens a single transaction, performs the row write, inserts exactly one `ap_map_event`, and returns. No route writes directly to the DB or fires `pg_notify` itself.

2. **WebSocket is broadcast-only.** Clients never mutate over the WebSocket. All mutations go through Server Actions or these routes.

3. **`{ ok, data, eventId }` response shape.** Every mutation route returns this JSON body (HTTP 200 on success, 400 on mutation-layer failure). Error responses before the mutation layer (401, 404, 400 for invalid input) also use `{ ok: false, error: string }`.

4. **Session + rights guard.** Every mutation route calls `requireMapMutate(rawMapId, session, '<right>')` from `utils.ts` (which chains session check + bigint parse + `requireMapRight` from `@/lib/auth/rights`). Read endpoints (e.g. `wormhole-types`, signature paste resolver) call `requireMapView`. The tuple result is mapped straight into a 401/403/404 response. Existence is never leaked: missing maps and non-viewable maps both return 404.

5. **Per-map rights enforcement.** Every mutation route passes a `MapRight` to `requireMapMutate`. The content-editing routes (systems, connections, signatures, subchain, thera, disconnected) all pass `'map_update'`, which resolves to **view authority** — every viewer can chart, since collaborative mapping is the product. Management routes (import/export pass `'map_import'` / `'map_export'`) resolve to the binary `canManageMap` (admin, private owner, owning-corp Director, or owning-alliance executor-corp Director). Map-settings edits use `requireMapManage` from the Server Action, not these routes. There is no controller path that bypasses these checks; the static-analysis test in `tests/unit/route-rights-coverage.test.ts` blocks regressions.

## Routes

| Method | Path | Helper | Event kind |
|--------|------|--------|-----------|
| POST | `/api/map/[mapId]/systems` | `addSystem` | `system.added` |
| PATCH | `/api/map/[mapId]/systems/[systemId]` | `updateSystem` | `system.updated` |
| DELETE | `/api/map/[mapId]/systems/[systemId]` | `removeSystem` | `system.removed` |
| POST | `/api/map/[mapId]/connections` | `createConnection` | `connection.create` |
| PATCH | `/api/map/[mapId]/connections/[connId]` | `updateConnection` | `connection.update` |
| DELETE | `/api/map/[mapId]/connections/[connId]` | `deleteConnection` | `connection.delete` |
| POST | `/api/map/[mapId]/connections/[connId]/restore` | `restoreConnection` | `system.added` (per hidden endpoint) + `connection.create` |
| POST | `/api/map/[mapId]/subchain` | `deleteSubchain` | `connection.delete` + `system.removed` (N events) |
| POST | `/api/map/[mapId]/signatures` | `createSignature` | `signature.create` |
| PATCH | `/api/map/[mapId]/signatures/[sigId]` | `updateSignature` | `signature.update` |
| DELETE | `/api/map/[mapId]/signatures/[sigId]` | `deleteSignature` | `signature.delete` |
| GET | `/api/map/[mapId]/wormhole-types?systemId=` | `wormholeTypesForSystem` | (read-only) |
| GET | `/api/map/[mapId]/system-search?q=` | `searchSystems` | (read-only) |
| POST | `/api/map/[mapId]/ping` | `pingSystem` | (transient broadcast — see below) |

`[systemId]` = `ap_map_system.id` (the xyflow node id, not the EVE solar-system id).  
`[sigId]` = `ap_map_signature.id` (the DB row id, not the in-game 3-char sig code).

## Exception: transient broadcast routes (no `ap_map_event`)

`POST /api/map/[mapId]/ping` is **not** a mutation and intentionally breaks invariant #1: it writes no row and emits no `ap_map_event`. A ping is a transient attention signal (a user drawing eyes to a system), so — like the server-observed `systemNotification` (zKB) and `connectionMassLog` events — it fans out with a direct `pg_notify` under the `systemNotification` task (kind `ping`) in `src/lib/map/ping.ts`. It still runs the session + access guard (`requireMapView` — the lowest bar, since it mutates nothing; tighten to `map_update` if a deployment needs to) and returns the minimal `{ ok }` shape rather than `{ ok, data, eventId }`. The initiator receives its own ping echo over realtime, so every viewer pulses identically via `MapUnderglowBridge`.

## Realtime propagation

After each mutation the `tg_map_event_notify` Postgres trigger fires `pg_notify('map:<mapId>', payload)`. The WS server's LISTEN handler picks this up and fans the `mapUpdate` envelope to all subscribed sockets. The initiating client dedupes by the `eventId` in the payload — it applies the change optimistically on call and drops the realtime echo when the `eventId` matches.

## Shared helpers

- `src/app/api/map/utils.ts` — `parseBigInt`, `guardMap`, `requireMapMutate`, `requireMapView`.
- `src/lib/auth/rights.ts` — the underlying `canViewMap` / `canMutateMap` / `requireMapRight` helpers.
- `src/lib/map/mutations/` — one file per entity: `core.ts`, `systems.ts`, `connections.ts`, `signatures.ts`.
- `src/lib/map/wormholeTypes.ts` — `wormholeTypesForSystem`, `staticMatchForConnection`.
