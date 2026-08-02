## loadMap.ts

**Purpose:** Server-only data-loading layer for the read-only map view — the single place the map page reads `ap_map*` + `universe_*` data.
**File:** `src/lib/map/loadMap.ts`

---

### loadMapForView(mapId: bigint, viewerCharacterId: bigint): Promise<MapViewData | null>
Loads one map for rendering. Returns `null` if the map is missing, soft-deleted, or the viewer is not allowed to see it (`canViewMap`). The viewer-id is required — passing the wrong one is an access-control bug the type system catches. Joins visible `ap_map_system` rows to `universe_system` / constellation / region (plus a LEFT JOIN on `ap_character` to resolve the lock holder's name, `lockedByName`), attaches wormhole static codes, loads the `ap_map_connection` rows whose **both** endpoints are currently visible **and** that are confirmed (`confirmed_at IS NOT NULL`) — orphan edges to hidden systems are excluded (their rows persist in the DB but would otherwise render as "Unknown" in consumers that iterate connections directly, e.g. `SystemOverlay`), and dormant `wh` connections (endpoint removed, sig not re-pasted) stay hidden so they don't resurface on reload; non-`wh` rows are always confirmed and so unaffected, and loads `ap_map_signature` rows for every visible system via `loadSignaturesForSystems` (`systemNode.ts` — the shared loader, LEFT JOIN to `universe_wormhole` to surface the WH code as `wormholeCode`; the same helper the per-system signatures endpoint uses). Also loads every `ap_map_note` on the map (two LEFT JOINs on `ap_character` to resolve the creator + last-editor names; notes are independent of system visibility) and calls `loadMapPresence(mapId)` so the returned `MapViewData` carries the initial roster of online tracked pilots. All `bigint` ids and `timestamptz`s are stringified (ISO for dates) so the result is serialisable across the Server→Client boundary.

---

### loadMapPresence(mapId: bigint): Promise<MapPresenceEntry[]>
Online tracked pilots on this map, wherever they currently are (their system need not be placed on the map). Joins `ap_map_character_tracking` × `ap_character` × `ap_user` (for `userId`/`mainCharacterId`) and self-joins `ap_character` (aliased `main_character`) to resolve `mainCharacterName`, left-joins `universe_type` for the ship type name + group id and `universe_system` for the location name + class (`systemName`/`systemSecurity`/`systemTrueSec`); also carries `shipName` (the pilot's custom hull name from `ap_character.last_ship_name`). `shipClass` is resolved from the joined group id via `resolveShipClass` (`src/lib/eve/shipClass.ts`). The account/main fields let the roster group alts under their main. Filters to `status = 'active' AND last_online = true AND last_system_id IS NOT NULL` — offline pilots are hidden per UX choice, and the `status='active'` clause is defense-in-depth so a kicked/banned pilot with a lingering tracking row never renders (view-access revocation on corp/alliance departure is handled separately by pruning the tracking row + `characterLogout`). Ordered by character name for stable hover-list rendering. The companion to the realtime `characterUpdate` envelope: same per-pilot shape (minus the always-true `online` flag), so the client merges live updates on top without converting between forms.

---

### loadMapSettings(viewerCharacterId: bigint, mapId: bigint): Promise<MapSettings | null>
Loads a map's editable metadata + behaviour toggles for the settings dialog. Gated by `canViewMap` (mirrors `loadMapForView`); returns null when the map is missing, soft-deleted, or not viewable. Pre-fill only — the dialog's Save re-checks `map_update` server-side.

---

### listViewableMaps(viewerCharacterId: bigint): Promise<MapListItem[]>
Maps the viewer can see, ordered by name. Feeds the `/maps` list. Filtered server-side via `viewableMapPredicate` — admins see every non-soft-deleted map; members see maps where they are the owner (by scope) or where one of their roles appears in `ap_map_role_access`.

---

### listAdminMaps(): Promise<AdminMapListItem[]>
Every `ap_map` the operator console can act on, **including soft-deleted rows** (which `listViewableMaps` filters out). Unscoped — `/admin` is global-admin-only. Distinct from the user-facing listing because the admin row shape carries the full owner FKs + `deleted_at` so the admin UI can render ownership and offer restore / purge-now actions. Soft-deleted rows are ordered first, then by name. Feeds `/admin/maps`.

---

### loadStatics(systemIds: number[]): Promise<Map<number, SystemStatics>>
Resolves each system's static wormholes to a display label (`universe_wormhole.target_class`, falling back to the raw code; K162-style statics with no resolvable label are excluded from `display` but still counted in `typeIds`) paired with the source `universe_wormhole.type_id`. Shared by `loadMapForView` and `loadPublicMapView` (`src/lib/map/loadPublicMap.md`).

---

### Types
- `MapSystemNode` — a visible system flattened with its universe metadata + statics. Carries `intelNotes` (`string | null`) so the inspector can read saved notes back, not just write them. `lockedByCharacterId` (number | null) + `lockedByName` (string | null) name the current lock holder (both null when unlocked or the character was erased), so the inspector shows who locked the system. `statics` is the display list — each `{ label, typeId }` pairs a target-class label (`universe_wormhole.target_class`, falling back to the catalog name when null) with its source `universe_wormhole.type_id`, so a node can key a per-static hover popover on the type; statics with no resolvable label (K162-style) are excluded. `staticTypeIds` is the full matching `universe_wormhole.type_id` set (includes the label-less K162-style statics), used client-side to compute WH-type dropdown class grouping without a per-system fetch. `rallyAt` is an ISO string when a rally point is active, otherwise null. `tradeHub` is `{ name, jumps } | null` — the nearest trade hub within high-sec range, read from the precomputed `universe_system.nearest_trade_hub_id/jumps` columns and resolved to a hub name via `apertureConfig.ROUTE_HUBS`; null when no hub qualifies.
- `MapConnectionEdge` — a connection with scope/mass/EOL/flag fields; endpoints are `ap_map_system.id` strings. `isStatic` is the user-designated "source system's static" flag (free manual toggle). `eolAt` (ISO or null) and `createdAt` (ISO) flow through so the canvas can compute the EOL countdown.
- `MapSignature` — a scan signature inside a placed system. `groupKey` is one of the seven scanner-level keys (or null). `classKind` (`signature` | `anomaly` | null) is the paste-derived Cosmic Signature vs Cosmic Anomaly distinction. `activityOverride` (`combat` | `exploration` | null) is the manual site-safety override that wins over the derived `siteActivity`; null falls back to the derived value. `typeId` is non-null only when `groupKey === 'wormhole'` and points at a `universe_type` row also present in `universe_wormhole`; `wormholeCode` is the LEFT JOIN of `universe_wormhole.name` for display ("B274", "K162", …). `name` carries the user-typed site name for cosmic sigs, or a mirror of the wormhole code for wormhole sigs. `eolStage` (`none`/`eol`/`critical`) is the pre-jump EOL stage for a wormhole sig, transferred onto the connection's `eolStage` on populate (shares the connection's enum). `expiresAt`, `createdAt`, and `updatedAt` are ISO strings.
- `MapNote` — a free-standing note on a map (`ap_map_note`): `{ id, title, content, severity, locked, positionX, positionY, createdByCharacterId, createdByName, lastEditedByCharacterId, lastEditedByName, createdAt, updatedAt }`. Mirrors the realtime `note.*` payload body. Attribution is denormalized: the creator/last-editor character ids (numbers, nullable) ride with their resolved names (nullable when the id is null or the character was erased). `severity` is the `map_note_severity` enum; `createdAt`/`updatedAt` are ISO.
- `MapPresenceEntry` — one online tracked pilot: `{ characterId, characterName, userId, mainCharacterId, mainCharacterName, systemId, systemName, systemSecurity, systemTrueSec, shipTypeId, shipTypeName, shipClass, shipName, locationAt }`. `userId` is the account id (grouping key); `mainCharacterId`/`mainCharacterName` identify the account's main (both null if no main is set). `systemId` is the EVE solar-system id; `systemName`/`systemSecurity`/`systemTrueSec` are the resolved `universe_system` fields (null when the id is unknown to the SDE); `shipClass` is the broad hull-class bucket resolved from the ship type's SDE group (`resolveShipClass`), null when the type is unknown; `locationAt` is ISO.
- `MapViewData` — `{ map, systems, connections, signatures, notes, presence }`, the page's full payload. `map` carries `tagScheme` + `homeMapSystemId` so the Tags panel knows the active scheme at load time (auto-tagging config propagates on next load, not via realtime).
- `MapListItem` — a map row for the user-facing list.
- `MapSettings` — editable map metadata + behaviour toggles for the settings dialog; `scope`/`type` are immutable post-create (shown read-only). Includes `tagScheme` + `homeMapSystemId` (owner/admin-gated on save); `exemptHomeStaticFromTag` opts the map into leaving the Home static target untagged (ABC only).
- `AdminMapListItem` — a map row for `/admin/maps`: includes owner FKs (`ownerCharacterId`/`ownerCorporationId`/`ownerAllianceId` as nullable strings), `createdAt`/`updatedAt`/`deletedAt` ISO strings, and the same identity fields as `MapListItem`.

These are re-exported from `src/types/index.ts`.

### Depends on
- `@/db/client` (`db`), `@/db/schema` (tables + enums), `@/lib/auth/rights` (`canViewMap`, `viewableMapPredicate`).
