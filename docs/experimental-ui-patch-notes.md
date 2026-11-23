# Experimental UI patch notes

All features below require the experimental UI (`ap_ui` cookie). Legacy UI is unchanged.

## Map & links

- Link importance styling, home-path brightening, hover dim and endpoint glow.
- Size badges and EOL purple outline: separate **EOL (~4h)** static outline vs **EOL critical (~1h)** slow pulse; critical mass red on the line stays louder.
- Pointer-cursor default (toggle in Account settings).

## Themes

- Four themes: Aperture default (`exp-dark`), Slate (`exp-slate`), Light, Classic.
- Theme toggle on the map toolbar and in the command palette.

## Pilots & alerts

- Pilot standing badge tint and shared hover delay on pilot cards (Account **Hover delay**, default 100 ms).
- Combat ring (10 m). Rally and active-route alerts are **off by default** sound events under Account → Sounds (same rows as core cues).

## QoL

- Keep selection on paste, Ctrl+Shift+V fast paste, link hover delay, command palette, paste preview, auto mass-from-log (off by default).

## Panels (BUILD 2)

- Tab groups: Inspector+Intel, Routes+Current Route, Pilots+Kills, Thera+D-Scan, System graph+Killboard+Tags; signatures under the map.
- **Pilots**, **Kills**, **D-Scan**, **Current Route** panels in layout v3.
- Per-panel **+ Add** headers and palette entries (`docs/aperture-panel-actions.md`).
- **⚙** popovers on Map, Signatures, Routes, Pilots (panel settings stub → `layout.panelSettings`).
- Signature **clean up** dialog; layout presets Scanning/Combat/Travel; **copy/export/import** layout JSON.
- DnD: merge pulse, tear-off ghost, larger tab drag ghost.
- Undo: per-panel stacks, **Ctrl+Z / Ctrl+Shift+Z**; map + signature mutations; **localStorage v2** serialized inverses (50 steps).

## Signatures (experimental)

- In-table **draft add row** (syncs when sig id committed).
- Default sort: unscanned first, then group; age row tiers; WH destination accent colours.
- WH row hover highlights link + far system on the map.
- Drag unlinked WH row onto a connection to link.

## Inspector (experimental)

- Summary strip: click-to-edit alias/tag/status; unset fields dimmed.

## Routes (experimental)

- Per-map **favourites**; **Set route** → active route + k-space ESI waypoint sequence.
- **Chain exit vs selected** origin; exit compare (top exits); hop click pans/highlights on map.
- Analysis summary per destination; one-click HS / Jita / staging (tag) / Thera / Turnur / **Home→fight**.
- Jump bridge toggle (default **on**, device-local); **Route here** context menu.
- Map highlight for selected route path (systems + links).

## Active route

- DB row `ap_map_active_route` (owner-only); followers on set-route dialog.
- **Current Route** panel: followers’ positions, refresh waypoints.
- Client monitor: off-route + EOL/deleted link hazards → opt-in toasts and **Recompute** (route-plan + save active route).

## Thera & D-Scan

- Thera: sort by name / jumps from Home / toward fight or hostile; one-click **+** add.
- D-Scan: class summary, diff vs previous, attach timestamp, fleet link stub.

## Pilots panel (experimental)

- Standing colours, ship role icons, kill badge fade, ticker tooltip, two-way map highlight.

## Data (schema)

- **0072** only: `ap_map_active_route`, `ap_map_route_favourite`. Staging = system tags; undo = localStorage; panel settings in saved layout.

## Harness (not production)

- `scripts/harness-session-cookie.ts`, `scripts/harness-playwright-capture.mjs`, `scripts/harness-map-perf.mjs` for signed-in :3005 captures (Playwright via temp `npm i playwright`, not a repo dependency).
