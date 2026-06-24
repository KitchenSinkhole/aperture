## index.ts (types)

**Purpose:** Canonical home for shared domain types. Re-exports Drizzle-inferred row types for the `universe_*` and `ap_*` tables.
**File:** `src/types/index.ts`

For each table `X` exports `X` (`InferSelectModel`) and `NewX` (`InferInsertModel`), e.g. `UniverseSystem` / `NewUniverseSystem`. Import row types from here, never re-infer inline.

Re-exports realtime wire-contract types and ESI opKey types.

Re-exports the ESI decoded-response types.

Re-exports `RealtimeStatus`.

Re-exports map-event payloads, mutation result/input types, signature parser/resolver types, and wormhole-catalog lookup results.

Re-exports `UniverseSovereigntyMap` / `UniverseFactionWarSystem`, ESI sov/FW decoded-response types, and read-side integration summaries (`SystemIntelSummary`, `SovereigntyIntel`, `FactionWarIntel`, `RecentKillSummary`, `EveScoutConnectionSummary`, `ChangelogRelease`). Also re-exports `SystemStatsSummary` (rolling 24h activity totals, `src/lib/map/stats.ts`).

Re-exports `SignatureGroupKey` (the `signature_group_key` pgEnum) and `SignatureGroupOption` for the scanner-level signature group catalog. The corresponding column on `ap_map_signature` is `groupKey: SignatureGroupKey | null` (replacing the prior `groupId` FK to `universe_group`). `CosmicSignatureGroupKey = Exclude<SignatureGroupKey, 'wormhole'>` is the union of the six non-wormhole groups whose site names live in the static catalog `src/lib/map/signatureSites.ts`. Also re-exports `SignatureClassKind` / `SignatureClassOption` for the localized scanner Class-column catalog (`src/lib/map/signatureClasses.ts`).

Re-exports the static-reference dialog types: `SystemEffect` / `SystemEffectBonus` / `SystemEffectKey` (`src/lib/eve/systemEffects.ts`) and `WormholeJumpInfoRow` (`src/lib/eve/wormholeJumpInfo.ts`).

Re-exports `ApStructure` / `ApStructureEvent` row types, `StructureEventKind` (the `structure_event_kind` pgEnum), the read-side view-models `StructureIntel` / `UpwellStructureType` (`src/lib/structures/read.ts`), the structure mutation input types, the structure client body shapes (`CreateStructureBody` / `UpdateStructureBody`), and `FetchResult` (the shared no-`eventId` JSON result from `src/lib/http/fetchJson.ts`).

The "add system manually" flow re-exports `SystemSearchResult` (`src/lib/map/systemSearch.ts`) — a solar-system search row used by `AddSystemDialog`.

The structure owner picker re-exports `CorpSearchResult` (`src/lib/structures/corpSearch.ts`) — `{ id, name }` corporation matches for the `StructureFormDialog` autocomplete.

Defines `UnderglowConfig` (directly defined, not a re-export) — the color/brightness/duration/speed knobs for the versatile map-node underglow (`src/components/map/SystemUnderglow.tsx`), keyed per notification kind in `underglowPresets.ts`.

Re-exports `TagScheme` (the `tag_scheme` pgEnum union: `none`/`abc`/`0121`) and the auto-tagging strategy contract from `src/lib/tagging/types.ts`: `ActiveScheme`, `TagSystem`, `TagEdge`, `TagContext`, `TagStrategy`, `AvailableTags`. `MapSettings` + `MapViewData.map` gain `tagScheme` + `homeMapSystemId`.

`MapContextMenuTarget` (directly defined) — the right-click target on the map canvas: a discriminated union over `system`/`connection`/`pane` carrying the row `id` (except `pane`) plus the cursor's client `x`/`y` for anchoring the menu. `null` ⇒ no menu open. Consumed by `MapContextMenu` (`src/components/map/MapContextMenu.tsx`) and driven by `MapCanvas`'s xyflow context-menu handlers.

Re-exports the Thera module types from `src/lib/map/thera.ts`: `TheraHub` (`'Thera' | 'Turnur'`), `TheraConnection` (oriented + class-enriched EVE-Scout row), `TheraSyncInput`, and `TheraSyncResult` (`{ summary, payloads }`).

Re-exports `ApMapConnectionLog` / `NewApMapConnectionLog` (the `ap_map_connection_log` row) and the `ConnectionMassLogEntry` view type — a display row for the per-jump connection mass-log (joined character + ship-type name, `mass`/`cumulativeMass` as `number` kg). See `src/lib/map/connectionMassLog.ts`.

The delete-subchain feature re-exports `DeleteSubchainInput`, `SubchainDeleteSummary`, and `SubchainDeleteResult` (`{ summary, payloads }`) from `src/lib/map/mutations/subchain.ts` — an N-event branch teardown matching the bulk-paste/Thera `{ summary, payloads }` shape. The Stage 4 sig-memory restore re-exports `RestoreConnectionInput` and `RestoreConnectionResult` (`{ payloads }`) from `src/lib/map/mutations/restoreConnection.ts` — an N-event re-confirm (`system.added` per hidden endpoint, then `connection.create`).

Permissions-overhaul adds `ApInstance` / `ApInstanceOwner` / `ApAccessGrant` row types (`+ New*`) and the enum unions `AccessMode`, `AccessPrincipal`, `AccessScope`, `AccessCapability` (from `src/db/schema/ap/enums.ts`).

Derived-authority (permissions multi-tenant, stage 1) adds `ApAlliance` / `NewApAlliance` row types (the `ap_alliance` executor-corp cache). `ApCharacter` gains the `isDirector` boolean. Both back the `canManageMap` / `canCreateMap` gates in `src/lib/auth/rights.ts`.

map-layout-builder adds the free-form map dashboard types (directly defined): `PanelId` (the 11 draggable cards), `Breakpoint` (`'lg'|'md'|'sm'`), and `MapLayoutConfig` (`{ version; layouts: Record<Breakpoint, Layout>; hidden: PanelId[] }`). `Layout` is `react-grid-layout`'s `readonly LayoutItem[]`, imported type-only (erased; safe in this server-imported barrel). Item `i` is structurally `string` — the `PanelId` constraint is enforced at the Zod boundary (`src/lib/map/layout/schema.ts`) and in `DEFAULT_MAP_LAYOUT` (`src/lib/map/layout/panels.ts`), not the structural type. Stored on `ap_user.map_layout`.

The in-map audit console re-exports the view-models + query contract from `src/lib/map/audit.ts`: `AuditEventCategory` (`'system'|'connection'|'signature'|'map'`), `AuditEventRow` (one rendered commit — id/occurredAt/kind/category/actor + human `summary`/`destructive`), `AuditActor` (a distinct actor for the filter dropdown, with account-main rollup), `ActorSummary` (per-category counts + destructive total for the drill-down header), `AuditQueryParams` (the API/query filter shape), and `AuditPage` (`{ rows, nextCursor }`).

routes-module adds `ApRouteDestination` / `NewApRouteDestination` row types, the enum unions `RouteSafety` (`shortest`/`safer`/`less_safe`) and `WhJumpMass` (`s`/`m`/`l`/`xl`), and the directly-defined planner domain types: `RoutePrefs` (per-account settings resolved from `ap_user`), `RouteHop` (one system on a route; `via` = how it was entered, with `connectionId`/`onMap`/`tag`), `RoutePlan` (`{ destinationSystemId, destinationName, reachable, jumps, hops }`), and `RouteDestinationView` (a saved destination joined to its system display fields). Computed by `src/lib/map/routePlanner.ts`, rendered by `RoutePlannerModule`.
