## page.tsx (map view)

**Purpose:** Read-only map view route (`/map/<id>`) — server-loads a map and renders it on the xyflow canvas with route, intel, and kill-stats sidebars.
**File:** `src/app/(app)/map/[[...slug]]/page.tsx`

### Renders
`<MapCanvas>` directly (the map name and meta are rendered inside the canvas toolbar row), preceded by a `CurrentMapScopeSync` that publishes the map's ownership class to header chrome. Empty-state `Card` (with a back-to-maps link) when no map id is in the slug or the map is missing/deleted.

### Behaviour & Interactions
- Optional catch-all slug; the first segment is the map id (numeric → bigint, else empty state).
- `loadMapForView(mapId, viewerCharacterId)` returns null for missing / soft-deleted / non-viewable maps → "Map not found" (does not leak existence).
- Precomputes 24h stats (`statsForSystems`), read-side intel (`intelForSystems`), manual structure intel (`structuresForSystems`), the map's editable settings (`loadMapSettings`, for the settings dialog), the viewer's connection-travel-animation toggle (`getConnectionTravelAnimation`), the viewer's resolved signature-indicator prefs (`getSignatureIndicatorPrefs` — threshold + toggles for the stale/unscanned node indicators), the account roster (`getAccountCharacters`), the account's route-planner config (`loadRouteConfig` — settings + saved destinations, routes-module), the main character id (`getMainCharacterId`), the viewer's derived management authority (`canManageMap` → `canManage`, which reveals the in-map settings/webhooks/audit surfaces), the viewer's delegated capability set (`resolveMapCapabilities` → `capabilities`, the per-feature reveal for delegated title-holders), and the map's live public share links (`loadLiveShareBadges` → `liveShares`, the seed for the canvas's share indicator) for all visible systems in parallel and passes them to the client canvas. Initial pilot-presence (`MapViewData.presence`) ships with the map payload from `loadMapForView`.
- `viewerCharacterIds` / `viewerCharacters` are derived from the account roster (active characters): the ids drive the CTRL+V fast-paste location check, and `{ id, name }` feeds the route planner's source-character picker. The hub-distance route module was replaced by `RoutePlannerModule`, so this page no longer computes `routesForSystems`.
- Session gating is handled by the `(app)` layout. No edit affordances.

### Depends On
- `@/lib/map/loadMap`, `@/lib/map/share` (`loadLiveShareBadges`), `@/lib/auth/rights` (`canManageMap`, `resolveMapCapabilities`), `@/lib/map/routeConfig`, `@/lib/map/stats`, `@/lib/map/intel`, `@/lib/structures/read`, `@/lib/session` (`getAccountCharacters`, `getConnectionTravelAnimation`, `getMainCharacterId`, `getMapLayout`, `getSignatureIndicatorPrefs`, `requireSession`), `@/components/map/MapCanvas`, `@/components/ui/card`. Behavior toggles, auto-tagging, webhooks, and the audit log are now in-place, gated by `canManage`.
