# Changelog

## v1.0.0

The first stable release, closing out eighteen release candidates.

Since rc.18: routes come with written directions you can paste into fleet chat, structure intel stays inside the corp or alliance that wrote it, and a second map open in another tab no longer picks up the first one's updates.

### New features

- **Written route directions** - the route planner turns a route into step by step instructions naming the sig to warp to at each hole, ready to copy into fleet chat. *(Ionis)*
- **Abyssal filament runs fold onto the map** - the abyssal tracking toggle in Map Settings now does something. Off by default. *(MonoliYoda)*
- **Privacy and cookie notice at `/privacy`** - lists every cookie Aperture sets and how account data is handled, worded so self-hosters can ship it unchanged. *(MonoliYoda)*

### Security

- **Structure intel is confined to the corp or alliance that wrote it** - each structure carries the audience of the map it was written on, shown as a chip on the row and named in the add/edit dialog before you submit. Nobody outside that audience can see or touch it. *(MonoliYoda)*
- **Maps no longer bleed into each other** - two maps open in two tabs each keep to themselves, and a signature or connection can only ever be attached to the map you are working on. *(MonoliYoda)*

### Improvements

- **The create-map dialog says why Corporation and Alliance are unavailable** instead of refusing after you submit. *(MonoliYoda)*
- **Insurgency Site is accepted as a Combat Site**, and site names containing "Wormhole" survive a paste. *(Ionis)*

### Fixes

- **Map settings only offer what you can actually do** - the General and Roles tabs and the delete button on `/maps` appear based on your rights, and saved settings survive reopening the dialog. *(MonoliYoda)*
- **A deleted map's share links and webhooks are properly closed off** during the 30-day grace period. *(MonoliYoda)*
- **Losing your pod in the abyss no longer draws a connection** on the map. *(MonoliYoda)*
- **SDE ingest no longer risks running the instance out of memory.** *(MonoliYoda)*
- **Docker builds install again.** *(MonoliYoda)*

### Misc

- Two map columns nothing read (`icon`, `log_activity`) are gone. *(MonoliYoda)*

### Upgrading

- Run `pnpm db:migrate` (migrations 0067 to 0070). Existing structure intel is backfilled, so nothing changes visibility.
- Abyssal jump tracking is off by default. Enable it per map in Map Settings.

### Contributors

- **Ionis** - written route directions, and Insurgency Site classification
- **MonoliYoda** - structure intel scoping, cross-map isolation, the map settings fixes, abyssal tracking, the create-map gate, and the privacy notice

## v1.0.0-rc.18

Wormhole ends can now be marked as bubbled so a camped hole reads at a glance, and static data keeps itself current instead of quietly drifting behind FC's builds.

### New features

- **Bubbled connection ends** - either mouth of a connection can be flagged as bubbled, drawn as a ring straddling the line at the mouth with a wash fading away along it. The two ends are independent, so a hole bubbled on one side only says exactly that. Right-clicking an endpoint opens its own menu with the toggle; the endpoint marks stay the same size on screen at any zoom, and their hit targets are sized off the fan so adjacent holes on one face never fight over the pointer. Bubble changes are named in the audit trail and webhook lines, including which end they happened at. *(MonoliYoda)*
- **Static data keeps itself current** - a daily job checks FC's published SDE build and ingests a newer one on its own. The ingest runs in an isolated child process behind acceptance gates that reject a bad build whole rather than half-writing it, so a broken publish can't leave the universe tables in pieces. *(MonoliYoda)*
- **A banner when static data is stale or failing** - an SDE that has fallen behind or whose refresh keeps failing now raises a banner naming the consequence (recently added systems or gates may be missing), instead of sitting silent in the logs. `/setup` shows which build the database actually holds, how the last check went, and offers cards to re-ingest or refresh on demand. *(MonoliYoda)*

### Improvements

- **Bubbles on public share links** - a share link can opt in to publishing the bubbled flags, so spectators see the same camps the map does. It is off by default, per link, alongside the existing signature toggles. *(MonoliYoda)*

### Fixes

- **Phantom wormholes between Kassigainen and Pakhshi** - the pinned SDE predated Cradle of War and was missing the gate that expansion added, so the two systems looked like they were joined by a hole. The refreshed build carries the gate. *(MonoliYoda)*
- **Test wormhole types no longer report as uncatalogued** - two unpublished QA types in the wormhole group produced codes "A" and "B" on every ingest, permanent noise on `/setup` that drowned out the one thing that list is for: a genuinely new hole type. They are skipped now. *(MonoliYoda)*
- **The map settings dialog fits its nine tabs** - the tab strip no longer scrolls sideways, and tall tabs (Roles & Permissions, Webhooks, Share links) scroll inside the panel rather than stretching the dialog past the viewport. *(MonoliYoda)*

### Misc

- **EVE SSO setup is documented** - the README covers registering the application and the scopes Aperture needs. *(MonoliYoda)*

### Upgrading

- Run the SDE ingest once after deploying, from the `/setup` console. The README's deployment section explains which card to use.

### Contributors

- **MonoliYoda** - bubbled connection ends, SDE self-refresh and staleness reporting, the Kassigainen-Pakhshi and settings-dialog fixes

## v1.0.0-rc.17

You can now share a live, read-only view of your chain with anyone via a link, systems with several holes on one side draw them properly fanned out, and tabs left open across a deploy tell you to reload.

### New features

- **Share your chain with a public link** - managers can mint an unguessable link that shows the map live to anyone, no login. Spectators get the chain plus a "directions in" board listing every k-space way in, with the sig to scan and the jumps to the nearest hub. *(MonoliYoda)*
- **Multiple holes on one side of a system fan out** - connections leaving the same face of a node now each get their own attachment point and are ordered so they never stack or cross. A busy system finally reads at a glance. *(MonoliYoda)*
- **A banner when the app has been updated** - after a deploy, an open tab is running an old version. Tabs now notice and offer a Reload button. A tab you left in the background reloads itself; a tab you are looking at never reloads from under you, so a half-typed intel note is safe. *(MonoliYoda)*

### Fixes

- **Fractional seconds in the integrations presence payload** - `online.seconds` could come back as a fraction, which strict consumers rejected. It is now always a whole number. *(MonoliYoda)*

### Misc

- **Spectator load is visible in metrics** - `/api/metrics` reports live spectator connections and upgrade outcomes, so a busy event can be told apart from spectators being turned away. *(MonoliYoda)*

### Contributors

- **MonoliYoda** - public map sharing, per-face connection fanning, the app-update banner, and the integrations presence fix

## v1.0.0-rc.16

Tracked pilots now show what they are flying, external tooling can read Aperture onlineness alongside activity, and untracking a character finally clears them off everyone else's map.

### New features

- **Ship-class icons for tracked pilots** - the pilot roster, the system presence popup and the Picture-in-Picture overlay all show an icon for the hull each tracked pilot is in, so a fleet's composition reads at a glance. Mining and industrial hulls whose SDE group is misleading (the Outrider is a command destroyer, but flies as a mining destroyer) are corrected to the class the game shows. *(Ionis)*
- **Presence for the integrations API** - `POST /api/integrations/activity-stats` buckets are now emitted on activity-or-presence and carry an `online` block (seconds/sessions/last-seen), clipped to the requested window. A new `POST /api/integrations/presence-sessions` exposes token-scoped bounded-window intervals for consumers building `character_session`-style history. *(MonoliYoda)*

### Improvements

- **Shattered filter in signature search** - a single Shattered toggle covers C13 and the five Drifter classes C14 to C18, rather than needing a class picked one at a time. *(MonoliYoda)*
- **"Jump mass" is now "Ship size"** in the connection context menu, the mass log and the inspector, matching how the sizes are actually talked about. *(MonoliYoda)*

### Fixes

- **Untracking a pilot removes them from other viewers' maps** - switching tracking off deleted the tracking row without telling anyone, so every other viewer kept the pilot on the map until they refreshed. Untracking now broadcasts the same eviction that a revoked-access prune does, and the location poll re-reads its map list immediately before fanning out so an in-flight tick can't resurrect a pilot who just left. *(MonoliYoda)*
- **The Picture-in-Picture overlay reopens at the size you left it** - resized width and height persist across sessions instead of snapping back to the default on every open. *(MonoliYoda)*

### Misc

- **`db:generate` produces correct diffs again** - the drizzle-kit snapshot chain stopped at migration 0010 while 0011 to 0058 were hand-written, so generation diffed against a stale baseline. A fresh 0058 snapshot restores incremental generation. *(MonoliYoda)*

### Contributors

- **Ionis** - ship-class icons across the pilot roster, presence popup and PiP overlay
- **MonoliYoda** - presence for the integrations API, the Shattered signature filter, the untracking and PiP-size fixes, and the drizzle snapshot rebaseline

## v1.0.0-rc.15

This release lets directors delegate individual director-gated map features to specific EVE corporation titles, adds a derived combat/exploration classifier for signature sites, and opens a machine-to-machine activity-stats endpoint for external tooling.

### New features

- **Per-title map feature delegation (R4)** - a director can hand a single director-gated map feature (audit, webhooks, settings, delete, import, export) to a specific EVE corporation title, from a new manager-only Roles & Permissions tab. Delegation is corp-scoped in v1 (private and alliance maps show it as unavailable); grants and revokes land as audit-visible `access.granted` / `access.revoked` events. *(MonoliYoda)*
- **Signature site-safety classifier** - signature rows now carry a derived combat-vs-exploration read (red swords / green shield-check), seeded from the whtype.info safe-explo dataset, with a manual right-click override back to Combat, Exploration, or Auto. The signature search panel gains a matching Any/Combat/Exploration filter. Wormhole signatures are exempt - they never show the glyph or the override menu. *(MonoliYoda)*
- **Activity-stats integration endpoint** - `POST /api/integrations/activity-stats` gives external tools token-authenticated, read-only access to per-character map activity, scoped to the token's corporation. Off by default behind `INTEGRATIONS_ENABLED`; tokens are minted, listed, and revoked with `pnpm integrations:mint-token`. *(MonoliYoda)*

### Misc

- **Docker build now copies the full `scripts/` directory** rather than just `scripts/data`, so `pnpm integrations:mint-token` and other operational scripts run inside the built image. *(MonoliYoda)*

### Contributors

- **MonoliYoda** - per-title map feature delegation, signature site-safety classifier, activity-stats integration endpoint, and the Docker scripts fix

## v1.0.0-rc.14

Aperture now understands fixed-destination wormholes and can resolve one onto the map in a single click. Plus a batch of wormhole-picker polish, a terminal EOL stage, and three fixes.

### New features

- **Fixed-destination wormholes** - holes that always exit to the same system now resolve onto the map in one click from the signature, no far-side scout needed. Seeded: J377 to Turnur, J492 to Tabbetzur, the C12 holes to Thera, and the Drifter holes to their complexes. Resolution is one-directional (a K162 never resolves). *(MonoliYoda)*
- **"Expired" EOL stage** - a fourth terminal stage (none to eol to critical to expired) set manually by scouts. Shows an elapsed readout ("Expired 3h ago"), renders red, and is reaped by the EOL-expiry job. *(MonoliYoda)*

### Improvements

- **Wormhole picker back-filter** - when a leads-to connection is set, the type picker narrows to types that fit its far-end class, with fixed-destination holes matched to their exact pinned system and shown by destination name. K162 and "Show all types" keep every type reachable. *(MonoliYoda)*
- **Wormhole picker grouped ordering** - the type picker now orders wandering and frigate holes by destination class, with a setting to switch back to alphabetical. *(MonoliYoda)*
- **Paste highlight** - rows a paste creates or updates briefly ping (green created, blue updated), visible only to the pilot who pasted. *(MonoliYoda)*

### Fixes

- **Transit-signature prompt race** - the new-hole prompt no longer misses when the jump breadcrumb beats the map fold; jumps are buffered until the fold lands. *(MonoliYoda)*
- **DB-down logins** now surface as a server error with a try-again message instead of a misleading "access denied". Still fails closed. *(MonoliYoda)*
- **zKillboard phantom flashes** - fixed both causes (cursor-null seed bug and a stale-feed freshness gap). *(MonoliYoda)*

### Contributors

- **MonoliYoda** - fixed-destination wormholes, expired EOL stage, wormhole-picker filtering and ordering, paste highlight, and the transit-prompt, login-gate and zKillboard fixes

## v1.0.0-rc.13

A small maintenance release on top of rc.12: renamed characters now pick up their new name without a re-login, and the zKillboard feed gained operational logging to make spurious system-kill flashes traceable.

### Fixes

- **Renamed characters refresh their name automatically** - a character's name was only ever copied from the login-time SSO token, which CCP does not refresh after a support-performed rename, so a renamed character kept showing the old name even across re-login. The name is now re-read from ESI's public profile on each authz resync, self-healing within the hour without a fresh login. *(MonoliYoda)*

### Scaling & reliability

- **zKillboard feed logging** - the kill feed now logs its fan-out and its operational failures (tick, fetch, decode), so spurious system-kill "underglow" flashes can be traced to their source. *(MonoliYoda)*

### Contributors

- **MonoliYoda** - character name refresh, zKillboard feed logging

## v1.0.0-rc.12

This release introduces tabbed panels - drag any panel onto another to stack them as tabs, reorder them, or tear one back out into its own cell. Wormhole details now show in hover-open popovers on both live connections and system statics, and the signature panel gains an EOL-stage control, a signature count and zebra striping. Under the hood, a batch of scaling work removes three growth ceilings - unbounded job-run history, accumulating zombie location-polls, and the shared-bucket killmail rate limit - that quietly degraded every deployment as it accrued characters and viewers.

### New features

- **Tabbed panels** - drag a panel's tab or title onto another panel's header to stack them as tabs in one cell, reorder tabs within a header, or drag a tab out into open grid space to split it back into its own cell. The layout model is group-aware per breakpoint and legacy layouts migrate transparently. *(MonoliYoda)*
- **Connection detail popover** - hovering a connection's badge opens a card with the source wormhole's type, size class, leads-to class, total stable mass, mass logged so far (as a share of the total), max jump mass, max lifetime, and a live EOL countdown for EOL-flagged holes. This also fixes the old on-edge label that doubled up with the badge and read the wrong time left. *(MonoliYoda)*
- **Static wormhole detail on hover** - hovering a system node's static label opens the same detail card, carrying the static's data (code, size, leads-to class, total mass, max jump, max lifetime). *(MonoliYoda)*
- **EOL stage control on signatures** - a wormhole signature can now carry a pre-jump EOL stage set from a three-stage picker in the signatures panel; the stage carries onto the connection when it populates, and once bound the connection's EOL is authoritative and editable from both places. *(MonoliYoda)*

### Improvements

- **Periodic refresh of on-map intel and stats** - system data for the whole on-map set is re-pulled every ~5 min so incursion/sov/FW decorators and the intel and stats modules catch mid-session drift without a reload; polling pauses while the tab is hidden. *(MonoliYoda)*
- **Signature count** shown in the signature panel. *(Ionis en Gravonere)*
- **Zebra-striped rows** on the signatures and signature-search panels for easier scanning. *(MonoliYoda)*
- **"Leads to" and "EOL" columns left empty for non-wormhole signatures**, rather than showing placeholder values. *(MonoliYoda)*
- **Route-path systems coloured by security status** rather than system type, so a plotted route reads by sec at a glance. *(Ionis en Gravonere)*
- **Who locked a system** is now shown next to the locked checkbox in the inspector, so an abandoned locked system's owner is visible without director-only audit access. *(MonoliYoda)*
- **DOTLAN pop-out links to the region map view** instead of the single-system view. *(MonoliYoda)*
- **Long ship names truncate** in the pilot roster table instead of stretching the column. *(MonoliYoda)*
- **Softened text contrast** and toned-down missing-signature borders. *(MonoliYoda)*
- **Manual-move gap decoupled from the auto-placement gap**, so nudging a system by hand no longer inherits the wider auto-placement spacing. *(MonoliYoda)*
- **Signature TTL column removed** from the signatures panel (it showed the same value for every row), and the signature purge shortened from 72h to 48h - the maximum a wormhole can stay open. *(MonoliYoda)*

### Fixes

- **Month and year activity stats no longer read zero early in a new month** - the rollup grouped by ISO week and filed a month-straddling week entirely under the earlier month, so a new month showed nothing for every pilot until its first Monday. The rollup is now daily-grain, making month and year boundaries calendar-exact; the first refresh back-corrects all history. *(MonoliYoda)*
- **HTML entities in ESI ship names are decoded**, so names render correctly instead of showing raw entity codes. *(MonoliYoda)*

### Scaling & reliability

- **Bounded `ap_job_run` growth** - the job-run log had grown to 91% of the database, driven almost entirely by one location-poll row per character every 5s. Successful high-frequency rows are now weight-sampled (~1-in-N, every failure still recorded, aggregate rates preserved), and the table is repartitioned daily with a 14-day rolloff. *(MonoliYoda)*
- **Fixed zombie location-poll accumulation** - expected ESI-outage ticks (breaker-open, downtime, post-refresh 401) now re-enqueue cleanly instead of minting permanently-failed NULL-key jobs the boot re-arm never reaped; legacy zombies are reaped on boot and excluded from the backlog gauge. *(MonoliYoda)*
- **Persistent killmail cache** - immutable ESI killmail bodies (~28k/day on prod, all against the shared unauthenticated rate-limit bucket) are now cached once in `universe_killmail`, so repeat killboard opens issue zero ESI calls; a daily reaper trims by kill time. *(MonoliYoda)*
- **Per-table row-count metric** (`db_table_rows`) exposed on `/api/metrics` from planner estimates, so table growth is graphable and alertable. *(MonoliYoda)*

### Contributors

- **MonoliYoda** - tabbed panels, connection and static detail popovers, signature EOL-stage control, periodic on-map refresh, lock-holder display, scaling-ceiling removals (job-run, zombie polls, killmail cache), and assorted polish
- **Ionis en Gravonere** - signature count, route-path security colouring

## v1.0.0-rc.11

This release adds an in-header Eve Time clock, turns signature search into a compact panel with anomaly/signature filtering, lets you send a system straight to the route planner from its context menu, and sharpens the D-Scan overlay comparison.

### New features

- **Eve Time (UTC) clock** in the app header, showing current EVE Online time with a downtime countdown and a popover of the same moment across key regional timezones. *(Ionis en Gravonere)*
- **Signature search panel** - the signature search moves out of a dialog into a compact, reactive panel that works on narrower screens; clicking "Go" snaps to the system carrying the signature without changing zoom. *(Ionis en Gravonere)*
- **Filter signatures by anomaly or signature status** - signature search can now narrow results to just anomalies or just signatures. *(Ionis en Gravonere)*
- **"Add to routes" system action** - right-clicking a system offers "Add to routes", saving it as a route-planner destination for the account. It persists through the Server Action even when the route panel is hidden, and a mounted route planner folds the new destination in without a reload. *(MonoliYoda)*

### Improvements

- **D-Scan overlay comparison** now renders as a sortable table, making it easier to compare an overlay against a fresh D-Scan. *(Caillou)*
- **Wormhole catalog fetched once per session** instead of per-dropdown, cutting redundant lookups when opening connection-type pickers and eliminating the flicker on wormhole signatures in the Signatures panel. *(MonoliYoda)*
- **Sticky, opaque headers** on the Signatures panel and Signature Search so column headers stay readable while the table scrolls. *(MonoliYoda)*
- **Autopilot destination clears existing waypoints** when set, so a new destination replaces the route rather than appending to it. *(MonoliYoda)*
- **Add System button removed from the map toolbar** - adding a system remains available from the pane right-click menu. *(MonoliYoda)*
- **Pilot-count badge** floats off the system node's top-left corner for a cleaner node layout. *(MonoliYoda)*
- **Auto-placement gap widened to 20px** for a bit more breathing room between freshly placed systems. *(MonoliYoda)*

### Fixes

- **Re-added systems place correctly on jump** - a soft-hidden system that a tracked pilot jumped back into via a different chain reappeared at its stale coordinates from the prior chain. Placement is now recomputed whenever a system is made visible, fanning it off the system just jumped from; alias, tag, status and intel are still preserved across the re-add. *(MonoliYoda)*

### Misc

- Documented the companion-`.md` anti-bloat rules in `CLAUDE.md`. *(MonoliYoda)*

### Contributors

- **MonoliYoda** - "Add to routes" action, wormhole-catalog caching, sticky signature headers, autopilot waypoint clearing, toolbar/node cleanups, re-placement fix, docs
- **Ionis en Gravonere** - Eve Time clock, signature search panel, anomaly/signature filtering
- **Caillou** - D-Scan overlay comparison table

## v1.0.0-rc.10

This release adds a full observability suite — metrics, an admin metrics page, instance alerting and client-error capture — and lets signature entries record whether they are a signature or an anomaly. It also refreshes the app's branding with the Aperture logo.

### New features

- **Observability suite** — Aperture now exposes Prometheus-style metrics across ESI, route planning, its own HTTP surface, background jobs and realtime fanout, sampled into `ap_metric_snapshot` for the new admin metrics page's history graphs. An in-process instance-alerting loop (booted from `server.ts` so it survives DB degradation) evaluates rules for breaker state, abandoned jobs and error rates, and a new `/api/client-errors` endpoint captures browser-side errors into `ap_error_log` under per-session and global rate limits. *(MonoliYoda)*
- **Signatures vs anomalies** — a scanned entry now records and displays whether it is a signature or an anomaly, instead of treating everything as a signature. *(Ionis en Gravonere)*

### Improvements

- **Aperture logo** now appears in the favicon, the app header and the login page. *(Caillou)*
- **Compact pilot table** — the system-presence popup uses a compact variant of the pilot table, keeping the full roster columns in a tighter footprint. *(Ionis en Gravonere)*
- **Dormant connections re-confirm on jump** — a wormhole connection that had gone dormant is re-confirmed when a tracked pilot is observed jumping through it. *(MonoliYoda)*
- **J377 wormhole** added to the wormhole-classes data. *(Ionis en Gravonere)*

### Fixes

- **Route planner no longer hydration-mismatches** on a persisted source system, fixing a client/server render mismatch when a saved source was restored. *(MonoliYoda)*

### Tuning

- **EOL wormhole safety buffer widened to 15%** (≈36 min on the 4h nominal lifetime), giving a more conservative collapse countdown on EOL-flagged connections. *(MonoliYoda)*

### Misc

- GitHub Actions workflow to announce releases on Discord. *(MonoliYoda)*
- CI guard that fails any PR targeting `master` (work lands on `dev`). *(MonoliYoda)*
- Runtime Docker image now bundles the `public` directory. *(MonoliYoda)*

### Contributors

- **MonoliYoda** — observability suite, dormant-connection re-confirm, route-planner hydration fix, EOL buffer tuning, release/CI/Docker tooling
- **Ionis en Gravonere** — signature/anomaly distinction, compact pilot table, J377 wormhole data
- **Caillou** — Aperture logo branding

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
