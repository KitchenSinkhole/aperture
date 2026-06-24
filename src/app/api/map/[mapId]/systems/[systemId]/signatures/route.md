## systems/[systemId]/signatures/route.ts

**Purpose:** Read-only JSON route returning one placed system's current signatures, for the canvas to hydrate a (re)added system's sigs on the `system.added` event.
**File:** `src/app/api/map/[mapId]/systems/[systemId]/signatures/route.ts`

---

### GET /api/map/[mapId]/systems/[systemId]/signatures
Returns `{ ok: true, data: MapSignature[] }` — the `ap_map_signature` rows for the system, LEFT JOINed to `universe_wormhole` for `wormholeCode`, ordered by `sigId`. `[]` for a brand-new system. `[systemId]` is `ap_map_system.id`, not the EVE solar-system id.

**Access:** view-only (`requireMapView`). The system must also belong to the guarded map (an explicit `ap_map_system.map_id = mapId` check) — otherwise a viewer of map A could harvest signatures from a system on map B by id. A foreign / missing system returns 404 without leaking existence.

**Why it exists:** signatures no longer ride the `system.added` event payload (a heavily-scanned re-add breached the 8 KB `pg_notify` ceiling and rolled the insert back). The event is now a pure node-body delta; `MapCanvas` calls this on every `system.added` (`fetchSystemSignatures` in `src/lib/map/client.ts`) and upserts the result into `viewData.signatures`, so a re-added system's surviving sigs converge on every tab without a reload. Reuses `loadSignaturesForSystems` (`src/lib/map/systemNode.ts`) — the same loader `loadMapForView` uses, so the wire shape matches the load-time signatures exactly.
