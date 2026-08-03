## index.ts (types)

**Purpose:** Canonical home for shared domain types. Re-exports Drizzle-inferred row types for the `universe_*` and `ap_*` tables.
**File:** `src/types/index.ts`

For each table `X` exports `X` (`InferSelectModel`) and `NewX` (`InferInsertModel`), e.g. `UniverseSystem` / `NewUniverseSystem`. Import row types from here, never re-infer inline.

Re-exports realtime wire-contract types and ESI opKey types.

Re-exports the ESI decoded-response types.

Re-exports `RealtimeStatus`.

Re-exports map-event payloads, mutation result/input types, signature parser/resolver types, and wormhole-catalog lookup results.

Re-exports `UniverseSovereigntyMap` / `UniverseFactionWarSystem`, ESI sov/FW decoded-response types, and read-side integration summaries (`SystemIntelSummary`, `SovereigntyIntel`, `FactionWarIntel`, `RecentKillSummary`, `EveScoutConnectionSummary`, `ChangelogRelease`). Also re-exports `SystemStatsSummary` (rolling 24h activity totals, `src/lib/map/stats.ts`).

Re-exports `SignatureGroupKey` (the `signature_group_key` pgEnum) and `SignatureGroupOption` for the scanner-level signature group catalog. The corresponding column on `ap_map_signature` is `groupKey: SignatureGroupKey | null` (replacing the prior `groupId` FK to `universe_group`). `CosmicSignatureGroupKey = Exclude<SignatureGroupKey, 'wormhole'>` is the union of the six non-wormhole groups whose site names live in the static catalog `src/lib/map/signatureSites.ts`. Also re-exports `SignatureClassKind` / `SignatureClassOption` for the localized scanner Class-column catalog (`src/lib/map/signatureClasses.ts`), and `SignatureActivity` (`'combat' | 'exploration'`) for the site-safety axis (`src/lib/map/siteActivity.ts`), orthogonal to `SignatureGroupKey`.

Re-exports the static-reference dialog types: `SystemEffect` / `SystemEffectBonus` / `SystemEffectKey` (`src/lib/eve/systemEffects.ts`) and `WormholeJumpInfoRow` (`src/lib/eve/wormholeJumpInfo.ts`).

Re-exports `ApStructure` / `ApStructureEvent` row types, `StructureEventKind` (the `structure_event_kind` pgEnum), the read-side view-models `StructureIntel` / `UpwellStructureType` (`src/lib/structures/read.ts`), the structure mutation input types, the structure client body shapes (`CreateStructureBody` / `UpdateStructureBody`), and `FetchResult` (the shared no-`eventId` JSON result from `src/lib/http/fetchJson.ts`).

The "add system manually" flow re-exports `SystemSearchResult` (`src/lib/map/systemSearch.ts`) — a solar-system search row used by `AddSystemDialog`.

The structure owner picker re-exports `CorpSearchResult` (`src/lib/structures/corpSearch.ts`) — `{ id, name }` corporation matches for the `StructureFormDialog` autocomplete.

Defines `UnderglowConfig` (directly defined, not a re-export) — the color/brightness/duration/speed knobs for the versatile map-node underglow (`src/components/map/SystemUnderglow.tsx`), keyed per notification kind in `underglowPresets.ts`.

Re-exports `TagScheme` (the `tag_scheme` pgEnum union: `none`/`abc`/`0121`) and the auto-tagging strategy contract from `src/lib/tagging/types.ts`: `ActiveScheme`, `TagSystem`, `TagEdge`, `TagContext`, `TagStrategy`, `AvailableTags`. `MapSettings` + `MapViewData.map` gain `tagScheme` + `homeMapSystemId`.

`MapContextMenuTarget` (directly defined) — the right-click target on the map canvas: a discriminated union over `system`/`connection`/`pane` carrying the row `id` (except `pane`) plus the cursor's client `x`/`y` for anchoring the menu. `null` ⇒ no menu open. Consumed by `MapContextMenu` (`src/components/map/MapContextMenu.tsx`) and driven by `MapCanvas`'s xyflow context-menu handlers.

Re-exports the Thera module types from `src/lib/map/thera.ts`: `TheraHub` (`'Thera' | 'Turnur'`), `TheraConnection` (oriented + class-enriched EVE-Scout row), `TheraSyncInput`, and `TheraSyncResult` (`{ summary, payloads }`).

Re-exports `ApMapConnectionLog` / `NewApMapConnectionLog` (the `ap_map_connection_log` row) and the `ConnectionMassLogEntry` view type — a display row for the per-jump connection mass-log (joined character + ship-type name, `mass`/`cumulativeMass` as `number` kg). See `src/lib/map/connectionMassLog.ts`.

`ShipClass` (directly defined) — the broad hull-class bucket for a ship type (`'frigate' | 'cruiser' | 'dreadnought' | ...`, 18 values), resolved server-side from `universe_type`'s SDE group by `resolveShipClass` (`src/lib/eve/shipClass.ts`). Feeds `ShipClassIcon` (`src/components/icons/ShipClassIcon.tsx`) and rides on `MapPresenceEntry.shipClass`.

The delete-subchain feature re-exports `DeleteSubchainInput`, `SubchainDeleteSummary`, and `SubchainDeleteResult` (`{ summary, payloads }`) from `src/lib/map/mutations/subchain.ts` — an N-event branch teardown matching the bulk-paste/Thera `{ summary, payloads }` shape. The Stage 4 sig-memory restore re-exports `RestoreConnectionInput` and `RestoreConnectionResult` (`{ payloads }`) from `src/lib/map/mutations/restoreConnection.ts` — an N-event re-confirm (`system.added` per hidden endpoint, then `connection.create`).

Permissions-overhaul adds `ApInstance` / `ApInstanceOwner` / `ApAccessGrant` row types (`+ New*`) and the enum unions `AccessMode`, `AccessPrincipal`, `AccessScope`, `AccessCapability` (from `src/db/schema/ap/enums.ts`).

Derived-authority (permissions multi-tenant, stage 1) adds `ApAlliance` / `NewApAlliance` row types (the `ap_alliance` executor-corp cache). `ApCharacter` gains the `isDirector` boolean. Both back the `canManageMap` / `canCreateMap` gates in `src/lib/auth/rights.ts`.

map-layout-builder adds the free-form map dashboard types (directly defined): `PanelId` (the 12 draggable cards), `Breakpoint` (`'lg'|'md'|'sm'`), `PanelGroup` (`{ id: string; members: PanelId[]; active: PanelId }` — a grid cell's ordered tab members and active tab; a singleton is an untabbed panel whose `id` is its member's `PanelId`), and `MapLayoutConfig` (`{ version; layouts: Record<Breakpoint, Layout>; groups: Record<Breakpoint, PanelGroup[]>; hidden: PanelId[] }`). Grouping is per-breakpoint, parallel to `layouts`; a `layouts[bp]` item's `i` is a group id. `StoredMapLayout` is the pre-normalisation read shape (`groups` optional) that `migrateLayout` upgrades to a full `MapLayoutConfig`. `Layout` is `react-grid-layout`'s `readonly LayoutItem[]`, imported type-only (erased; safe in this server-imported barrel). Item `i`, group id, and member/active ids are structurally loose — the `PanelId` constraint is enforced at the Zod boundary (`src/lib/map/layout/schema.ts`) and in `DEFAULT_MAP_LAYOUT` (`src/lib/map/layout/panels.ts`), not the structural type. Stored on `ap_user.map_layout`.

The in-map audit console re-exports the view-models + query contract from `src/lib/map/audit.ts`: `AuditEventCategory` (`'system'|'connection'|'signature'|'note'|'map'|'access'`), `AuditEventRow` (one rendered commit — id/occurredAt/kind/category/actor + human `summary`/`destructive`), `AuditActor` (a distinct actor for the filter dropdown, with account-main rollup), `ActorSummary` (per-category counts + destructive total for the drill-down header), `AuditQueryParams` (the API/query filter shape), and `AuditPage` (`{ rows, nextCursor }`).

Per-title feature delegation (R4) adds the directly-defined view-model backing the Roles & Permissions tab: `DelegationRole` (`{ roleId, label, capabilities: MapCapability[] }` — one corp title and the capabilities delegated to it on a map; `view` is implicit and never listed) and `MapDelegationState` (`{ available: false } | { available: true; roles: DelegationRole[] }` — `available` is false on non-corp maps in v1). Produced by `src/app/(app)/actions/mapRoles.ts`.

routes-module adds `ApRouteDestination` / `NewApRouteDestination` row types, the enum unions `RouteSafety` (`shortest`/`safer`/`less_safe`) and `WhJumpMass` (`s`/`m`/`l`/`xl`), and the directly-defined planner domain types: `RoutePrefs` (per-account settings resolved from `ap_user`), `RouteHop` (one system on a route; `via` = how it was entered, with `connectionId`/`onMap`/`tag`), `RoutePlan` (`{ destinationSystemId, destinationName, reachable, jumps, hops }`), and `RouteDestinationView` (a saved destination joined to its system display fields). Computed by `src/lib/map/routePlanner.ts`, rendered by `RoutePlannerModule`.

Observability (Phase 1) adds the health-probe types (directly defined): `HealthComponentStatus` (`'ok'|'degraded'|'down'|'unknown'`), `HealthComponentName` (`'db'|'realtimeBus'|'worker'|'esi'|'migrations'`), `HealthComponent` (`{ status, detail? }`), and `HealthReport` (`{ status, checkedAt, components }`). Produced by `src/lib/health/probe.ts`, served by `GET /api/health/ready`. The route returns 503 iff `HealthReport.status` is `down`.

Observability (Phase 2) adds the metrics types (directly defined): `MetricLabels` (`Record<string,string>`), `EsiMetricOutcome` (`'success'|'http_error'|'decode_error'|'breaker_open'|'downtime'|'rate_limited'|'token_error'`), `CounterSnapshot` / `HistogramSnapshot` (one metric's name/help + per-label-set series; histogram buckets are cumulative `le` bounds), `MetricsSnapshot` (`{ counters, histograms }`), and `GaugeReadings` (instantaneous gauges: tracked characters, visible systems, session WS connections, public spectator WS connections, open ESI breakers, job backlog/abandoned, db pool total/idle/waiting, process memory + event-loop lag, plus `tableRows: TableRowEstimate[]` — per-`ap_*`/`universe_*`-table row estimates rendered as `db_table_rows{table}`). `TableRowEstimate` is `{ table, rows }`. Produced by `src/lib/metrics/registry.ts` (cumulative) and `src/lib/metrics/gauges.ts` (instantaneous); PII-free by construction.

Observability (Phase 8) adds the deepened-instrumentation outcome label types (directly defined, all bounded string-literal unions so call-site labels stay typed and low-cardinality): `JobOutcome` (`'success'|'failure'` — `job_runs_total`), `LocationPollOutcome` (the `PollNotes` stop reasons plus `online`/`offline`/`esi-outage` — `location_polls_total`), `WebhookOutcome` (`'success'|'rate_limited'|'http_4xx'|'http_5xx'|'network_error'` — `webhook_deliveries_total`), `TokenRefreshOutcome` (`'success'|'missing_token'|'http_error'|'invalid_response'` — `esi_token_refresh_total`), `JwkRefreshOutcome` (`'success'|'error'` — `jwk_cache_refresh_total`), and `PublicWsUpgradeOutcome` (`'accepted'|'rate_limited'|'unauthorized'|'at_cap'` — `public_ws_upgrades_total`).

Observability (Phase 6) adds the instance-alerting types (directly defined, no DB-derived rows — alert state is in-memory): `AlertRuleKey` (`'db'|'worker'|'esi_breakers'|'job_abandoned'|'error_rate'`), `AlertRuleStatus` (`'ok'|'degraded'|'down'|'unknown'`; `unknown` is a no-op so a DB-backed rule can't false-resolve during a DB outage), `AlertSignals` (one gather of every signal — DB-probe latency, worker staleness, open breakers, abandoned jobs, recent errors — each nullable when unreachable), `AlertRuleResult` (`{ key, status, detail }`), and `AlertTransition` (`{ key, kind: 'fire'|'resolve', status, detail, firingSince }`). Consumed by `src/lib/alerts/rules.ts` (pure rules + dedup state machine) and `src/lib/alerts/scheduler.ts` (the loop, booted from `server.ts`); PII-free by construction.

Public map share adds `ApMapShare` / `NewApMapShare` row types, the enum union `SharePresenceMode` (`none`/`anonymous`/`full`, the `share_presence_mode` pgEnum), and the directly-defined `ShareRedactionProfile` (`{ presenceMode, showSignatures, showConnectionSigIds }`) — the per-token flag set `resolveShareToken` (`src/lib/map/share.ts`) resolves and the public projection branches on. Two management-side shapes ride alongside it: `MapShareListItem` (`ShareRedactionProfile & { id, token, label, expiresAt, expired, createdAt, createdByName }`) is one row of the Share links panel and carries the raw token for the copy-link button, so it is only ever returned to a viewer holding `share_manage`; `LiveShareBadge` (`{ id, label, expiresAt }`) is the token-free feed for the in-map indicator every viewer of the map sees.

Redacted public-share view-model types (shaped in `src/lib/map/loadPublicMap.ts`): `PublicMapSystemNode`, `PublicMapConnectionEdge`, `PublicMapSignature`, `PublicPresenceSystemCount`, `PublicPresencePilot`, `PublicMapPresence`, `PublicMapViewData`. Distinct types from their `loadMap.ts` counterparts, not `Omit`/`Partial` derivations — they have no field capable of carrying an intel note, a map note, structure intel, an audit entry, or per-row attribution.
