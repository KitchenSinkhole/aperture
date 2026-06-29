# Changelog

## v1.0.0-rc.9

This release adds collaborative map notes, replaces the system presence popup with a full pilot table, and lets you share dashboard layouts as a file.

### New features

- **Map notes** — drop free-form notes anywhere on the map as their own nodes, edited inline and shared live with everyone viewing the map. Notes are a first-class map entity (`ap_map_note`) with their own create/edit/delete API and audit trail. *(MonoliYoda)*

### Improvements

- **System presence shows a pilot table** — clicking a system node's presence badge now opens a pilot table with the same columns as the pilot roster view instead of the old popup. `PilotRosterTable` was extracted from `PilotRoster` so both share the same columns. *(Ionis en Gravonere, MonoliYoda)*
- **Shareable dashboard layouts** — export the current map dashboard layout to `aperture-layout.json` and import it back on any map; imported files are re-validated and panels re-placed before the layout is applied. *(MonoliYoda)*

### Contributors

- **MonoliYoda** — map notes feature, dashboard layout export/import, presence-table integration
- **Ionis en Gravonere** — system presence pilot-roster table

## v1.0.0-rc.8

This release fixes an intermittent failure where adding a heavily-scanned system to the map could silently roll back, and refreshes the Docker deployment setup.

### Fixes

- **Adding a heavily-scanned system no longer fails intermittently** — re-adding a system that carried many surviving signatures embedded those signatures into the `system.added` event, whose `pg_notify` payload could exceed Postgres' 8 KB limit (37 signatures ≈ 11 KB). The overflow raised "payload string too long" inside the `AFTER INSERT` trigger and rolled back the insert, so the system silently failed to add. `system.added` is now a pure node delta again, and a (re)added system's signatures are hydrated on demand through a new view-gated signatures endpoint, mirroring the live-added-system backfill. *(MonoliYoda)*

### Misc

- Refreshed Docker deployment configuration and the related README / CONTRIBUTING notes. *(MonoliYoda)*

### Contributors

- **MonoliYoda** — signature-hydration regression fix, Docker deployment update

## v1.0.0-rc.7

This release fixes a regression from rc.6 where wormhole connections drawn automatically — by a tracked pilot jumping a hole, by Thera ingest, or by a map transfer — would show up live and then silently vanish the next time the map was loaded.

### Fixes

- **Auto-drawn connections no longer disappear on reload** — rc.6 began showing a wormhole connection only while it is "confirmed by a current observation," but only manually drawn connections were being stamped as confirmed. Connections created by the server-side location poll when a tracked pilot jumps a wormhole (plus Thera ingest and map transfer) were born unconfirmed, so they appeared for everyone watching live and then dropped off on the next reload, leaving no audit trail. `confirmed_at` now defaults at the database level, so every connection is confirmed the moment it's created no matter how it was drawn. The intended hide-on-endpoint-removal behaviour is unchanged. *(MonoliYoda)*

### Contributors

- **MonoliYoda** — connection-confirmation regression fix

## v1.0.0-rc.6

This release makes signatures and wormhole connections survive re-adds and reloads without a refresh, and corrects two wormhole-type suggestion errors so Drifter and shattered systems are classified from the data instead of stale id lists.

### Improvements

- **Signatures re-hydrate on re-add** — re-adding a soft-removed system now carries its surviving signatures in the same broadcast, so every tab shows them immediately without a reload. *(MonoliYoda)*
- **Self-healing signature updates** — a signature update can now carry a full-row snapshot, so a client whose baseline is missing or stale (reconnect gaps, missed creates, reordering) repairs itself instead of silently dropping the change. *(MonoliYoda)*
- **Sig-memory connection restore** — when a paste re-confirms a wormhole signature whose remembered connection was hidden, a non-blocking prompt offers to restore the connection and its endpoint, preserving the observed wormhole state. *(MonoliYoda)*

### Fixes

- **Unconfirmed connections no longer resurface on reload** — wormhole connections are shown only while confirmed by a current signature observation; removing an endpoint now dormants its `wh` connection rather than leaving it to reappear after a refresh. Structural links are unaffected. *(MonoliYoda)*
- **Drifter holes stay out of J-space suggestions** — the five Drifter wormholes (B735/C414/R259/S877/V928) are now scoped to k-space, so they no longer appear in the default suggestion list for every system. *(MonoliYoda)*
- **Shattered systems detected from the J-sig** — shattered detection now derives from the system name (the J0xxxxx band plus Thera) instead of a hardcoded id set, dropping two wrongly-pinned ids (J164104, J115422) and naturally excluding the Drifter systems. *(MonoliYoda)*

### Contributors

- **MonoliYoda** — signature re-hydration and self-heal, connection confirmation state and restore, Drifter and shattered-system classification fixes

## v1.0.0-rc.5

This release protects locked systems from deletion, sharpens the proximity badge with a trade-hub initial, and fixes two signature-panel annoyances.

### Improvements

- **Locked systems are protected from deletion** — every delete path (single, group, subchain, disconnected) now rolls back if any locked system is in the doomed set. The relevant context-menu items and the inspector Remove button are greyed out, each hinting which system to unlock first. *(MonoliYoda)*
- **Trade-hub initial in the proximity badge** — the nearest trade hub's initial now follows the jump count (e.g. "3J" for Jita, "5R" for Rens, "4H" for Hek) instead of a generic "j" suffix; the full hub name stays in the tooltip. *(MonoliYoda)*

### Fixes

- Signature dropdowns no longer snap shut when another viewer edits a signature in the same system during a realtime update. *(MonoliYoda)*
- Removed the duplicate "Combat" options from the signature type dropdown and combat filter. *(MonoliYoda)*

### Contributors

- **MonoliYoda** — locked-system delete guard, proximity-badge polish, signature-panel fixes

## v1.0.0-rc.4

This release adds map ping and rally tooling, refines the wormhole type selector and signature search, and corrects several wormhole static-data issues.

### New features

- **Map ping and rally** — new overlay buttons to ping the map and rally tracked pilots to a chosen map node, with a hidden rallypoint easter egg. Ping notifications now stay up longer. *(Ionis en Gravonere)*

### Improvements

- **Signature search system tag** — search results now carry a system tag. *(Ionis en Gravonere)*
- **Discoverable signature search** — the search Go button is more discoverable. *(MonoliYoda)*
- **Wormhole type selector** — K162 now sorts after statics with a separator. *(Ionis en Gravonere)*
- **Connection mass log ordering** — jumps are returned newest-first so the latest activity is shown at the top. *(Ionis en Gravonere)*
- **Copyable system name** — the inspector system name can now be selected for copy. *(MonoliYoda)*
- **Re-home an alt** — an alt can be moved onto the linking account, with audit re-attribution. *(MonoliYoda)*

### Fixes

- Homefront combat site signatures now paste correctly despite being in the database. *(Ionis en Gravonere)*
- C13 small shattered Wolf-Rayet systems are now labeled A, B, C, etc. *(Ionis en Gravonere)*
- Added missing Pochven wormholes to the wormhole-classes seed data. *(Ionis en Gravonere)*
- Renamed Thera to C12 in the wormhole-classes data to match Aperture conventions. *(Ionis en Gravonere)*

### Misc

- Replaced CCP with Fenris Creations in trademark notices. *(Ionis en Gravonere)*

### Contributors

- **Ionis en Gravonere** — ping/rally tooling, wormhole selector and signature search refinements, static-data fixes
- **MonoliYoda** — alt re-homing, inspector copy polish

## v1.0.0-rc.3

This release hardens character access and tracking around corp/alliance membership changes, so leavers lose access promptly and joiners are picked up quickly.

### Access control

- **Faster, more accurate affiliation resolution** — corp/alliance is now resolved from the ~1h-cached ESI affiliation endpoint instead of the ~24h-cached public character profile, so new members gate in within the hour rather than the next day.
- **Revocation on corp departure** — character cleanup gains an affiliation sweep that detects corp/alliance changes and revokes access: it re-syncs authz, prunes map tracking the pilot can no longer view, and broadcasts a logout. A pilot who leaves the owning corp/alliance of a restricted deployment is now signed out.

### Tracking

- **Auto-track on regained access** — a re-joining or newly-added character is now automatically tracked on already-opened maps, mirroring the existing prune-on-departure behaviour. Wired into both re-login (add-alt) and corp re-join without a fresh login.

### Fixes

- Removed redundant padding from indented alts in the pilot view. *(Ionis en Gravonere)*

### Contributors

- **Ionis en Gravonere** — pilot view polish

## v1.0.0-rc.2

### Fixes

- Let every map viewer edit map content (systems, signatures, connections); content editing is view-gated rather than restricted to managers.

## v1.0.0-rc.1

First release candidate for 1.0.0. This is a large release headlined by a rework of the permissions model, plus new map tooling (audit log, signature search) and a migration to CCP's 2026 ESI.

### Breaking — Permissions & multitenancy rework

Admin authority is now **derived from EVE roles and instance ownership** rather than hand-managed tiers:

- Any EVE Corp **Director** resolves to admin authority over their own corp's maps; global `admin` comes only from an explicit grant or instance ownership.
- The old per-corp **manager** tier and the **corp-rights matrix** have been removed (`authz_level` is now `member` | `admin`).
- Moderation actions and the `/admin` console are now **admin-only**.

### New features

- **Map audit log viewer** — browse a map's change history with filtering and manual refresh.
- **Signature search** — new dialog to search signatures across systems, with wormhole/k-space security class grouping, type filters, and click-to-navigate row highlighting. *(Ionis en Gravonere)*
- **Set-destination submenu** — when multiple tracked characters are located, pick which one to route from the map context menu. *(Ionis en Gravonere)*
- **Faction Warfare and incursion system decorators** — systems now show FW and incursion status.
- **Low-contrast mode** — accessibility option for reduced-contrast theming.

### ESI 2026 migration

*Contributed by Ionis en Gravonere.*

- Replaced the deprecated ESI Swagger spec with the **OpenAPI spec**, with typed access via `openapi-types`.
- Now sends **`X-Compatibility-Date`**; sovereignty decoder migrated to the 2026 ESI shape, plus an alliance decoder.

### Fixes

- Fixed system stats failing to load on newly-added map systems.
- Tracked pilots no longer pollute maps with systems they merely transit while Aperture is closed.
- UI polish: audit log dialog sizing, scrollbar and select theming, map settings dialog width.

### Contributors

- **Ionis en Gravonere** — signature search, set-destination submenu, ESI 2026 migration
