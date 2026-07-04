## RoutePlannerModule

**Purpose:** Configurable multi-hop route planner panel (routes-module) — shortest path from a picked source (active character or selected system) to each saved destination, over K-space stargates + the live wormhole chain (+ optional EVE-Scout), shown as security-coloured breadcrumbs. Replaces the old read-only hub-distance `RouteModule`.
**File:** `src/components/sidebar/RoutePlannerModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Map id for the `route-plan` + `system-search` endpoints. |
| selectedSystemId | number \| null | yes | The currently selected system on the map (EVE system ID), or null if no selection. |
| initialPrefs | RoutePrefs | yes | Server-loaded route settings; seeds local state. |
| initialDestinations | RouteDestinationView[] | yes | Server-loaded saved destinations; seeds local list. |
| connections | MapConnectionEdge[] | yes | The map's live connections; drives recompute when the chain changes. |

### Renders
A `Card` ("Routes") with: a **controls row** with a **From** label and two toggle chips ("Active character" / "Selected system"), **Safety** select, and **Min ship** select — in a `@container` grid that stacks (1 col) when the card is narrow and spreads to one row (3 cols) at `@md`; optional **fallback prompts** when the chosen source has no system (character mode, no located chars → system search field; system mode, no selected system → "Select a system on the map"); an Avoid-reduced / Avoid-critical / Avoid-EOL / EVE-Scout toggle-chip box; and the destination list — each row a name + `Nj` jump count, a remove (✕), and a breadcrumb of per-hop **markers** — **circles** for wormhole (J-space) systems (class `C#` or `J######` name), **squares** for K-space (fill = system colour — K-space by its fine-grained security-status gradient, wormhole/Pochven/Abyssal by class colour. Each marker shows the system's `[tag]` (when set) + name + via label in a hover/focus `Tooltip` (base-ui). An inline "Add destination…" typeahead at the bottom.

### Behaviour & Interactions
- **Route source persistence** — choice between "Active character" and "Selected system" is persisted to `localStorage` under key `aperture:routes:source`; survives tab refresh.
- **Character mode source** — reads `activeCharSystemId` from `useMapActiveChar()` context; when it changes (character jumps), route recomputes without UI flicker. Fallback: when no character is located, show a `SystemSearchField` to manually pick a start system (stored in `manualSource` state); this fallback is independent of "Selected system" mode.
- **System mode source** — uses the `selectedSystemId` prop (the map's primary selection, updated every render when the user clicks a system).
- **Recompute** — debounced (300ms) `POST /api/map/[mapId]/route-plan` whenever the source, prefs, destinations, or a connection signature (`id:scope:mass:eol:jumpMass`) changes; out-of-order responses are dropped via a seq ref; results stored locally.
- **Persistence** — prefs changes optimistically update local state and fire `setRoutePrefsAction` in a transition; destination add/remove optimistically update the local list and call `addRouteDestinationAction` / `removeRouteDestinationAction`.
- **External additions** — subscribes to `subscribeRouteDestinations`; a destination saved by the map context-menu "Add to routes" item is folded into the local list (deduped by `systemId`) so it appears without a reload.
- `SystemSearchField` (inline) reuses `searchSystemsOnServer` (the map `system-search` endpoint) for both the manual-source fallback and add-destination typeaheads. Its result list (`SearchResults`) is **portalled to `document.body`** and pinned under the input via the input's `getBoundingClientRect()` (re-measured on capture-phase scroll + resize) — the enclosing `Card` is `overflow-hidden`, which would otherwise clip an absolutely-positioned dropdown at the card edge.

### Emits / Calls
- `setRoutePrefsAction`, `addRouteDestinationAction`, `removeRouteDestinationAction` (`@/app/(app)/actions/routes`)
- `subscribeRouteDestinations` (`@/lib/map/routeDestinationBus`) — folds context-menu "Add to routes" additions
- `requestJson('POST', /api/map/<id>/route-plan)` → `RoutePlan[]`
- `useMapActiveChar()` — reads `activeCharSystemId` (the active character's current location from presence data)
- `searchSystemsOnServer` — system typeahead search for the manual-source fallback and add-destination fields
- `systemSecurityColor` — marker/name tint (K-space security-status gradient, else class colour)

### Local State
- `routeSource: 'character' | 'system'` — toggled between active character and selected system; persisted to localStorage
- `prefs: RoutePrefs`, `destinations: RouteDestinationView[]` — seeded from props, mutated optimistically
- `manualSource: SystemSearchResult | null` — fallback manual system pick when character mode has no located character
- `plans: RoutePlan[]`, `computing: boolean` — computed routes from source to each destination
- `computeSeq: number` (ref) — sequence counter for deduping old async responses
