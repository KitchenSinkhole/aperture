## user.ts

**Purpose:** The `ap_user` account anchor — groups the one-or-more characters a person owns (auth principal).
**File:** `src/db/schema/ap/user.ts`

---

### apUser
`pgTable('ap_user', …)`:
- `id` — `integer generated always as identity`, PK.
- `main_character_id` (`mainCharacterId`) — nullable `bigint`. The account's "main" character. Login resolves the active character to this value ("land on main"); statistics / activity roll up to it. The real FK → `ap_character.id` `ON DELETE set null` is declared in migration `0018_account_main_character.sql`, **not** inline here — an inline `.references()` would create a circular schema import (`character.ts` already imports `apUser`). Bootstrapped to the first character on first login; user-changeable in Account Settings.
- `connection_travel_animation` (`connectionTravelAnimation`) — `boolean NOT NULL DEFAULT true` (migration `0022`). Per-account toggle for the connection travel animation — a subtle moving dot played along a connection when a tracked pilot jumps across it. Read via `getConnectionTravelAnimation` (`session.ts`), written by `setConnectionTravelAnimationAction` (`actions/account.ts`), toggled in the Account Settings dialog.
- `map_layout` (`mapLayout`) — nullable `jsonb`, `.$type<MapLayoutConfig>()` (migration `0033`). The account's free-form map dashboard arrangement (map-layout-builder) — one global layout (react-grid-layout geometry + hidden set) applied to every map the account opens. NULL ⇒ the client falls back to `DEFAULT_MAP_LAYOUT` (no per-account row is seeded). Read via `getMapLayout` (`session.ts`), written by `setMapLayoutAction` (`actions/account.ts`) after Zod validation at the boundary (`src/lib/map/layout/schema.ts`).
- `stale_signature_threshold_minutes` (`staleSignatureThresholdMinutes`) — nullable `integer` (migration `0035`). Personal override of the global `ap_instance.stale_signature_threshold_minutes` for the stale-signature map indicator. NULL ⇒ use the global default. A non-null value is **capped at the global on write** (`setSignatureIndicatorPrefsAction`): a user may only make the indicator *more* eager (a smaller value), never ignore the corp default with a larger one.
- `show_stale_signature_indicator` (`showStaleSignatureIndicator`) — `boolean NOT NULL DEFAULT true` (migration `0035`). Toggles the stale/empty (clock) indicator for this account.
- `show_unscanned_signature_indicator` (`showUnscannedSignatureIndicator`) — `boolean NOT NULL DEFAULT true` (migration `0035`). Toggles the unscanned (signal) indicator for this account. Both are resolved with the threshold by `getSignatureIndicatorPrefs` (`session.ts`) and written by `setSignatureIndicatorPrefsAction` (`actions/account.ts`), toggled in the Account Settings dialog.
- **routes-module route-planner settings** (migration `0036`) — per-account, applied to every map; personal config, not map data. Read into `RoutePrefs` and written by `setRoutePrefsAction` (`actions/routes.ts`); consumed by `src/lib/map/routePlanner.ts`.
  - `route_safety` (`routeSafety`) — `route_safety NOT NULL DEFAULT 'shortest'`. EVE autopilot preference (shortest / safer / less_safe).
  - `route_min_ship_class` (`routeMinShipClass`) — nullable `wh_jump_mass`. Minimum ship size that must fit through any wormhole on the route; NULL ⇒ no minimum. A WH edge whose `jump_mass_class` ranks below this is dropped from the routed graph (unknown/null jump-mass is kept).
  - `route_avoid_reduced` / `route_avoid_critical` (`routeAvoidReduced` / `routeAvoidCritical`) — `boolean NOT NULL DEFAULT false`. Drop reduced- / critical-mass wormholes from the routed graph.
  - `route_avoid_eol` (`routeAvoidEol`) — `boolean NOT NULL DEFAULT false`. Drop wormholes whose `eol_stage <> 'none'`.
  - `route_include_eve_scout` (`routeIncludeEveScout`) — `boolean NOT NULL DEFAULT false`. Fold the public EVE-Scout Thera/Turnur connections into the routed graph.
- `created_at` / `updated_at` — `timestamptz`, default `now()`.

One user is created per newly-seen character. Additional characters are linked onto an existing user via the SSO tile grid / "add character" flow; `ap_character.user_id` FKs here.
