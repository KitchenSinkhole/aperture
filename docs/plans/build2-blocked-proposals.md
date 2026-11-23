# BUILD 2 — blocked items (schema / dependency proposals)

Items stopped pending PD approval. No migrations landed on `experimental-ui-panels`.

## Active routes + ESI multi-waypoint follow

- **`ap_active_route`** (per character, per map): `character_id`, `map_id`, `destination_system_id`, `plan_json` (hops snapshot), `waypoint_cursor`, `updated_at`.
- **`ap_active_route_follower`**: which characters subscribe to reroute toasts.
- **API extension**: batched `POST /api/character/waypoint` sequence (first `clear_other_waypoints=true`, rest append) — today only single-destination replace exists.
- **Notifications**: route EOL/collapse toasts reuse experimental alert prefs (new toggles).

## Route favourites per map + staging systems

- **`ap_map_route_pin`**: `(user_id, map_id, system_id, label?, shared boolean)`.
- **`ap_map_staging_system`**: `(map_id, map_system_id)` many rows per map.

## Undo persistence across reload

- Either extend `ap_user` jsonb `experimental_undo` per panel (cap 50) or localStorage-only (implemented in-memory only in BUILD 2 slice).

## New grid panels

- **Current Route**, **Pilots**, **Kills** (chain-wide), **D-Scan** as first-class `PanelId`s — requires panel registry, layout schema bump, and module splits (today pilots live in toolbar popover; D-Scan in system overlay).

## Layout presets + per-grid settings in DB

- Per-map grid settings in `ap_map.layout_settings jsonb` or extend `ap_user.map_layout` with scoped settings blob; export/import endpoints.
