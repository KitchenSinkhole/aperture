# Blackout

**Goal:** An instance-wide switch that hides every tracked pilot's presence from everyone except the pilot's own account and an explicit cleared list, for home-defense and hole-control ops (issue #210).
**References:** CLAUDE.md (Realtime, Mutation pathways, Background jobs, Database, companion rules), issue #210, `src/lib/realtime/wsServer.md`, `src/lib/realtime/protocol.md`, `src/lib/jobs/tasks/locationPoll.md`, `src/lib/map/loadMap.md`, `src/db/schema/ap/access_grant.md`, `src/db/schema/ap/instance.md`.

**Background:** Presence leaves the server by six paths, and every one has to be closed on the server (a member can read the socket in devtools, so hiding in the browser is not enough):

1. The session socket's `characterUpdate` / `characterLogout` frames (every online pilot, every 5s, on every map they are tracked on).
2. The initial roster in the map page load (`loadMapPresence`).
3. `GET /api/map/[mapId]/viewers`, which tells any viewer whose account has the map open.
4. The mass log (`connectionMassLog` frames and `GET …/connections/[connId]/mass-log`): who jumped which ship through which hole.
5. Auto-mapping: systems and connections appearing as pilots jump.
6. Public share links (`/live/<token>`): presence in the snapshot, plus a `publicUpdate` nudge on every presence frame.

The viewer's own location has no separate path: the client picks the viewer's characters out of the same roster (`MapActiveCharContext`). So "hide others" and "show me" are one filter with one rule.

**Key design decisions (agreed up front):**

- **Name: Blackout.**
- **Instance-wide, one switch.** `ap_instance.blackout_since` (`timestamptz`, NULL = off) plus `ap_instance.blackout_by_character_id` (→ `ap_character`, `ON DELETE SET NULL`). Only global admins flip it, from `/admin/settings`. No auto-expiry: the banner is the safeguard against a forgotten blackout. The public free-for-all deployment has only its operator as admin and simply doesn't use it; no code gates it there.
- **The cleared list is instance grants.** A new `access_capability` value `blackout_view` on `ap_access_grant` with `scope='instance'`. Principals are `character` or `role` only (a `corp_title` role is one corp's specific title); `corporation` / `alliance` principals are rejected by a CHECK, because those are the people being hidden from. Optional `expires_at` and `note` work as they already do. The grant never confers login (`loginGate.ts` reads only `login` / `admin`).
- **Who is cleared.** Global admins implicitly; nobody else. Directors are not implicit. Director is an EVE corp role, not a title, so Directors are cleared by adding them by name.
- **Clearance is per account.** An account is cleared when any of its active characters is a global admin, holds an unexpired `blackout_view` grant by name, or holds a title with an unexpired grant. Kicked / banned characters never count. A cleared FC on a scout alt still sees.
- **What a non-cleared viewer sees while on:** only their own account's pilots, on every surface (system badges, roster, pilot count, PiP overlay, viewers poll). Everything keyed off "where am I" keeps working: CTRL+V fast paste, route planner from the active character, the overlay header, own-system sound cues.
- **Tracking keeps running; auto-mapping stops.** The location poll is unchanged (cleared viewers need it). While on, no tracked jump folds onto any map: no `system.added`, `connection.create` or tag events. Manual mapping by anyone is unaffected.
- **Mass log keeps recording, cleared-only while on.** A jump through a hole already on the map (a confirmed `wh` connection between two visible systems) is still logged. While on, only cleared viewers see the log (live frames and the inspector fetch). When Blackout lifts, everyone sees all of it, including entries written during it: lifting means the coast is clear.
- **Public share links** show presence `none` while on, regardless of the link's profile, and send no presence nudges. Nothing on the public page or in its payload mentions Blackout.
- **Attribution.** While on, Discord history posts omit the actor, and the in-map audit console hides actors from viewers who aren't cleared (Directors hold `audit_view` but are not implicitly cleared). After the lift the audit console shows actors normally; Discord posts already sent stay as they are.
- **Banner.** Every map view shows a persistent, non-dismissible Blackout banner to every viewer, cleared or not, distinct from the degraded-realtime banner and naming no individual. Two variants: cleared ("members can't see pilots; you can") and not cleared ("pilot locations are hidden; you still see your own characters").
- **Transport.** The task vocabulary is fixed and has no instance-wide task, so Blackout state rides the control-plane `healthCheck` envelope as an optional per-socket field `blackout: { active, since, cleared }`. The SharedWorker already fans control-plane frames to every tab. Flips and list edits emit a `pg_notify` on a dedicated instance channel; the WS server listens on it and answers with an immediate `healthCheck` to every session socket.
- **Transitions.** On: each non-cleared client prunes its presence store to its own account when the state arrives, and the server stops sending. Off: pilots reappear within one online poll tick, because every online tick broadcasts. No per-tick signal of any kind may exist for a hidden pilot: even a removal arriving every 5s says "online".
- **One predicate seam.** Every egress asks one question, "is this pilot hidden from this viewer?", through `src/lib/auth/blackout.ts`: `isPilotHidden(viewer, pilotUserId)` for per-pilot presence, `isBlackedOut(viewer)` for surfaces hidden wholesale (mass log, audit actors), both over a `BlackoutViewer` (`{ active, cleared, userId }`). A later per-map mode would change that answer, not every call site.

**Accepted costs for members while on:** the overlay's D-Scan recognises only the viewer's own characters as friendly; no "which signature did you jump?" prompt (it needs the auto-created connection); no travel animation or arrive / leave / watched-jump cues for other pilots; an empty roster apart from their own characters.

**Non-goals:** per-map Blackout; hiding map content (systems, connections, signatures, "which statics we're connected to"), which needs a restricted ops map and is a separate issue; attribution on notes and system locks; signature timestamps; the Statistics dialog; the integrations API (operator-token-authed); letting non-admins flip the switch; auto-expiry.

---

## Stage 1 — Schema and clearance resolver
**Mode:** Execute
**Status:** done — 9f2df903
**Goal:** Blackout state and the cleared list exist in the database, and one server module answers "is Blackout on?" and "is this account cleared?".
**References:** `src/db/schema/ap/instance.md`, `src/db/schema/ap/access_grant.md`, `src/db/schema/ap/enums.md`, `src/db/schema/ap/role.md`, `src/lib/auth/resolveAuthz.md`, `src/lib/auth/loginGate.md`, `src/db/migrations/0061_map_share_management.sql` (enum `ADD VALUE` precedent); memory: `db:generate` works, `.rollback.sql` is hand-written.
**Touches:** `src/db/schema/ap/instance.ts` (+ `.md`): `blackout_since`, `blackout_by_character_id`. `src/db/schema/ap/enums.ts` (+ `.md`): `access_capability` gains `blackout_view`, appended. `src/db/schema/ap/access_grant.ts` (+ `.md`): the capability/scope CHECK admits `blackout_view` at instance scope; a new CHECK limits `blackout_view` rows to `character` / `role` principals. New migration plus hand-written `.rollback.sql`. New `src/lib/auth/blackout.ts` (+ `.md`): `getBlackoutState()` → `{ active, since, byCharacterId }`, `isBlackoutCleared(userId)`, and the shared visibility predicate the later stages call. No `import 'server-only'`: the module is reached from `wsServer.ts` and the location-poll runner. `src/types/index.ts` (+ `.md`) for exported types. DB tests.
**Done when:** The migration applies and rolls back cleanly on the dev DB. `RUN_DB_TESTS` cover `isBlackoutCleared`: an admin's account is cleared; a by-name grant clears every character on that account; a title grant clears a holder's account; an expired grant is ignored; a kicked or banned character's grant or title is ignored; an unrelated account is not cleared. A `blackout_view` grant with a `corporation` principal is rejected by the DB, and a `blackout_view` grant does not pass the login gate. CI green.

## Stage 2 — Admin switch and cleared list
**Mode:** Execute
**Status:** done — 2fca429d
**Goal:** Global admins can turn Blackout on and off and manage the cleared list from `/admin/settings`.
**References:** `src/app/(admin)/admin/settings/page.md`, `src/app/(admin)/actions/settings.md`, `src/components/admin/StaleThresholdForm.md`, `src/components/setup/InstanceAccessPanel.md` (grant-list precedent), `src/components/map/manage/MapRolesForm.md` (corp-title listing), `src/lib/auth/blackout.md`.
**Touches:** New `src/app/(admin)/actions/blackout.ts` (+ `.md`): `isAdmin`-gated actions to turn Blackout on / off (sets / clears `blackout_since` + `blackout_by_character_id`), add a `blackout_view` grant (character or corp-title role, optional expiry and note), remove one, plus the loader the panel reads. Every mutation emits the instance-channel `pg_notify` (channel name a constant in `aperture.config.ts`) and revalidates. New `src/components/admin/BlackoutPanel.tsx` (+ `.md`): one card with the switch (state, since, who turned it on), the cleared list (name, kind, corp for titles, expiry, note, remove), and add controls: a picker over characters Aperture knows and a corp → title picker over known `corp_title` roles. Turning Blackout on asks for confirmation; turning it off doesn't. `src/app/(admin)/admin/settings/page.tsx` (+ `.md`) mounts the panel.
**Done when:** Tests: every action rejects a non-admin; on / off sets and clears `since` + `by`; add rejects `corporation` / `alliance` principals and unknown ids; expiry and note are stored; remove refuses an id that names a `login` / `admin` grant (only `blackout_view` rows are removable from this panel); every mutation emits the notify. CI green.

## Stage 3 — Realtime enforcement
**Mode:** Execute
**Status:** done — 87ef79e0
**Goal:** While Blackout is on, a session socket that isn't cleared receives no presence or mass-log frame about pilots outside its own account, public sockets receive no presence nudge, and every open tab learns the Blackout state live.
**References:** `src/lib/realtime/wsServer.md`, `src/lib/realtime/bus.md`, `src/lib/realtime/protocol.md`, `src/lib/realtime/sharedWorker.md`, `src/lib/auth/blackout.md`.
**Touches:** `src/lib/realtime/protocol.ts` (+ `.md`): `healthCheckLoadSchema` gains optional `blackout: { active, since, cleared }`. `src/lib/realtime/bus.ts` (+ `.md`): LISTEN on the instance channel (`apertureConfig.INSTANCE_NOTIFY_CHANNEL`, empty payload) for the bus's lifetime and expose a subscription to it; it is not a map channel and produces no map envelope. `src/lib/realtime/wsServer.ts` (+ `.md`):
- holds the Blackout state in memory, loaded at attach and refreshed on every instance notify;
- resolves each session socket's clearance on connect, on every instance notify, and on each heartbeat while Blackout is on, so a title lost at the next authz resync takes effect within one heartbeat;
- runs a pure, exported filter on the session forward (the `bus.subscribe(id, …)` call). While on and not cleared: `characterUpdate` passes only when `load.userId` is the socket's account; `characterLogout` passes only for the socket's own characters (narrowed, or dropped when none remain); `connectionMassLog` is dropped. Every other task is unchanged;
- on the public path, while on, `characterUpdate` / `characterLogout` stop nudging;
- every `healthCheck` to a session socket carries that socket's `blackout` state, built per socket, and an instance notify triggers an immediate one to every session socket.
**Done when:** Unit tests over the filter cover `characterUpdate`, `characterLogout`, `connectionMassLog`, `mapUpdate` and `systemNotification` × on / off × cleared / not cleared × own / other account. The public translator drops presence nudges while on and keeps `mapUpdate` nudges. A test with the existing WS test seams shows an instance notify producing an immediate `healthCheck` with re-resolved per-socket state. CI green.

## Stage 4 — Read paths
**Mode:** Execute
**Status:** done — e7589b79
**Goal:** The map page load, the viewers endpoint, the mass-log endpoint and public share links apply the same rule as the socket.
**References:** `src/lib/map/loadMap.md`, `src/lib/map/loadPublicMap.md`, `src/lib/map/publicSnapshot.md`, `src/app/api/map/[mapId]/viewers/route.md`, `src/app/api/map/[mapId]/connections/[connId]/mass-log/route.md`, `src/app/(app)/map/[[...slug]]/page.md`, `src/lib/auth/blackout.md`.
**Touches:** `src/lib/map/loadMap.ts` (+ `.md`): `loadMapPresence` becomes viewer-aware and, while on and not cleared, returns only the viewer's account's pilots; the page's load also carries the viewer's initial Blackout state for Stage 7 to seed from, typed as `BlackoutStatus` (`{ active, since: ISO string | null, cleared }`, from `@/types`), the same shape `healthCheck.blackout` carries. `src/lib/map/loadPublicMap.ts` (+ `.md`): presence is `{ mode: 'none' }` while on; `PublicMapViewData` gains no Blackout field. `src/lib/map/publicSnapshot.ts` (+ `.md`): a flip must not leave presence in a cached snapshot: clear the cache from the flip actions, `adminStartBlackout` / `adminEndBlackout` in `src/app/(admin)/actions/blackout.ts` (+ `.md`). Not from `bus.onInstanceNotify`: the bus is a `globalThis` singleton only outside production, so in production a Next-side subscriber would get its own bus instance and a second LISTEN connection. `invalidatePublicSnapshot` is per-token, so this needs a clear-all. `src/app/api/map/[mapId]/viewers/route.ts` (+ `.md`): while on and not cleared, only the viewer's own character ids. `src/app/api/map/[mapId]/connections/[connId]/mass-log/route.ts` (+ `.md`): while on and not cleared, no entries plus a marker the inspector can render as "hidden during Blackout". `src/app/(app)/map/[[...slug]]/page.tsx` (+ `.md`) threads the viewer.
**Done when:** `RUN_DB_TESTS` / route tests: while on, a non-cleared viewer's initial roster holds only their own account and a cleared viewer's holds everyone; while off, unchanged. The public payload has presence `none` while on and no Blackout field, and a snapshot cached before a flip is not served after it. The viewers route returns only own ids to a non-cleared viewer while on. The mass-log route returns the marker to a non-cleared viewer while on, the full log to a cleared one, and the full log to everyone once off. CI green.

## Stage 5 — Location poll
**Mode:** Execute
**Status:** done — 104b91c4
**Goal:** While Blackout is on, a tracked jump never changes any map, but a jump through a hole already on the map still lands in its mass log.
**References:** `src/lib/jobs/tasks/locationPoll.md`, `src/lib/jobs/locationCommit.md`, `src/lib/map/connectionMassLog.md`, `src/lib/auth/blackout.md`; memory: runner modules must not import `server-only`; location-poll success-path tests need a `Math.random` pin (job-run sampling).
**Touches:** `src/lib/jobs/tasks/locationPoll.ts` (+ `.md`): reads the Blackout state each tick (no new cadence knob); while on, skips `foldJumpOntoMap` on every tracked map, resolves the traversed connection read-only instead, and logs mass when that connection is `wh`-scoped; `PollNotes` records the skip. `src/lib/jobs/locationCommit.ts` (+ `.md`): exports the read-only lookup (a confirmed connection between two visible systems, either direction, no writes). Tests.
**Done when:** Tests: while on, a jump between two visible systems joined by a confirmed `wh` connection writes one mass-log row and its notify and zero `ap_map_event` rows; a jump with an endpoint off the map writes nothing; an abyssal jump writes nothing. While off, the existing poll and fold tests pass unchanged. The `characterUpdate` broadcast is identical in both states. `pnpm dev` boots the job runner (lint, typecheck and build don't catch a `server-only` import on the runner path). CI green.

## Stage 6 — Attribution
**Mode:** Execute
**Status:** done — 6746c7b2
**Goal:** While Blackout is on, Discord history posts carry no actor and the in-map audit console hides actors from viewers who aren't cleared.
**References:** `src/lib/webhooks/dispatcher.md`, `src/lib/webhooks/formatters.md`, `src/lib/map/audit.md`, `src/app/api/map/[mapId]/audit/route.md`, `src/components/map/manage/MapAuditBrowser.md`, `src/lib/auth/blackout.md`.
**Touches:** `src/lib/webhooks/dispatcher.ts` / `formatters.ts` (+ `.md`): the history message drops its leading actor when Blackout is on at dispatch time. `src/lib/map/audit.ts` and the audit route (+ `.md`): for a non-cleared viewer while on (`isBlackedOut(await getBlackoutStatus(session.userId))`, the pattern the Stage 4 routes use), rows carry no actor and the actor list and per-actor drill-down are unavailable. `src/components/map/manage/MapAuditBrowser.tsx` (+ `.md`): renders the hidden-actor state. Tests.
**Done when:** Tests: while on, the Discord history text carries no character name; while off, unchanged. While on, a non-cleared viewer's audit page has no actor fields and no actor list, a cleared viewer's is unchanged, and everyone's is unchanged once off. CI green.

## Stage 7 — Client state and presence pruning
**Mode:** Execute
**Status:** done — fac16881
**Goal:** The map client knows the viewer's Blackout state from first paint and live, and a non-cleared viewer's presence collapses to their own account the moment Blackout applies to them.
**References:** `src/lib/realtime/useRealtime.md`, `src/components/map/MapPresenceContext.md`, `src/components/map/MapActiveCharContext.md`, `src/components/map/MapCanvas.md`, `src/app/(app)/map/[[...slug]]/page.md`.
**Touches:** `src/lib/realtime/useRealtime.tsx` (+ `.md`): surfaces the latest `healthCheck.blackout` (`BlackoutStatus`) through a hook, seeded from the page's initial state (`MapViewData.blackout`, which Stage 4 put on the map payload; the `/api/map/[mapId]` resync snapshot carries it too) until the first `healthCheck` arrives (a tab joining an already-running SharedWorker otherwise waits a full heartbeat). A `healthCheck` without `blackout` (the server hasn't read the switch yet) keeps the current value. `src/components/map/MapPresenceContext.tsx` (+ `.md`): when the state becomes on and not cleared, drops every entry outside the viewer's account. `src/components/map/MapCanvas.tsx` (+ `.md`) and `src/app/(app)/map/[[...slug]]/page.tsx` thread the initial state and the viewer's account identity. Tests.
**Done when:** Unit tests: the prune keeps only the viewer's account's entries; a change from off to on-and-not-cleared prunes; a cleared viewer is never pruned; after a change back to off, later `characterUpdate`s repopulate the store. CI green.

## Stage 8 — Blackout UI surfaces
**Mode:** Execute
**Status:** done — eefce7f8
**Goal:** Every map view shows an unmissable Blackout banner, and the roster and mass-log inspector say why they're empty.
**References:** `src/components/RealtimeStatusBanner.md` (banner precedent), `src/components/map/MapCanvas.md`, `src/components/map/PilotRoster.md`, `src/components/map/PilotRosterButton.md`, `src/components/sidebar/ConnectionMassLog.md`; the `frontend-design` skill for the banner.
**Touches:** New `src/components/map/BlackoutBanner.tsx` (+ `.md`): full-width, persistent, non-dismissible, high-contrast strip at the top of the map view, visually distinct from the degraded-realtime banner; the two variants from the design decisions; names no individual; may show the start time. Copy has no em-dashes. Starting copy: not cleared "Blackout in effect. Pilot locations are hidden. You can still see your own characters."; cleared "Blackout in effect. Members can't see pilot locations. You can." `src/components/map/MapCanvas.tsx` (+ `.md`) mounts it, feeding it the `blackout` value the canvas already derives (`useBlackoutStatus(viewData.blackout)` from `@/lib/realtime/useRealtime`); the roster's "pilots are hidden" condition is that same value's `active && !cleared`, threaded or read the same way rather than re-derived. `src/components/map/PilotRoster.tsx` / `PilotRosterButton.tsx` (+ `.md`): an empty-state line while pilots are hidden. `src/components/sidebar/ConnectionMassLog.tsx` (+ `.md`): renders Stage 4's marker. The marker is `hidden: true` beside `data: []` on the mass-log route's `{ ok: true, … }` body; `fetchConnectionMassLog` in `src/lib/map/client.ts` (+ `.md`) types its result as a plain `FetchResult<ConnectionMassLogEntry[]>`, so it has to be widened to carry `hidden` (the field already survives at runtime). The public `/live` page is untouched.
**Done when:** Component tests: both banner variants render from state, and nothing renders while off; the roster empty state and the mass-log hidden state render from their inputs. CI green.

## Manual verification
_(worked by the user once, after the run — the plan is not complete until it passes)_
- **Stage 2** — In `/admin/settings` as an admin: turning Blackout on asks for confirmation and shows since + who; turning it off clears them; a character and a corp title can be added (with and without expiry) and removed; a non-admin never sees the card.
- **Stage 3** — Two browsers on one map, an admin and a non-cleared member, with a third pilot moving: in the member's devtools WS frames there is no `characterUpdate` or `connectionMassLog` for other accounts while Blackout is on, and the member's own `characterUpdate`s keep arriving. Flipping the switch reaches both browsers within a second.
- **Stage 4** — Reload as the member during Blackout: the roster shows only their own characters. A `/live` link set to full presence shows no pilots and nothing about Blackout.
- **Stage 5** — During Blackout, jumping an unmapped hole adds nothing to the map; jumping a mapped hole adds a mass-log entry the admin sees and the member doesn't; after the lift the member sees that entry.
- **Stage 6** — A Discord history post made during Blackout has no name in it. The audit console shows no actors to a non-cleared Director and shows them to an admin.
- **Stages 7–8** — The banner shows on every map view in both variants. During Blackout the member's CTRL+V fast paste and the route planner's "Active character" source still work. Turning Blackout off brings other pilots back within about 5s without a reload.
- **Stage 8** — The banner reads clearly in both light and dark themes and alongside the degraded-realtime banner. During Blackout the member's pilot roster says pilot locations are hidden and the connection inspector's mass log says it is hidden during Blackout; turning Blackout off makes an already-open inspector show the log without reselecting the connection.

## Notes
_(appended by executing sessions — non-obvious findings only)_
- Drizzle's migrator applies every pending migration in one transaction, so a migration that might be batched with `0072` must not parse `'blackout_view'` as an enum literal (CHECK, default, seed). `0072` compares `capability::text`; runtime queries are unaffected.
- `ap_instance` is a singleton and `RUN_DB_TESTS` runs against the live dev DB: any test that flips Blackout must snapshot and restore the row.
- `loginGate.ts` filters grants to `login` / `admin`; keep it that way so a `blackout_view` grant never lets anyone log in.
- `bus.ts`'s `dispatch` returns early for any channel without the `map:` prefix, so the instance channel needs its own branch ahead of that check, or its notifies are silently dropped.
- Grant expiry and title changes from the authz resync emit no instance notify; only the Stage 2 actions do. Stage 3's per-heartbeat re-resolve is what picks those up.
- Until Stage 3, no `healthCheck` carries per-socket state. The `blackout` field makes it per-socket, so it has to be built for each socket, not once and broadcast.
- Every Blackout DB test file flips the `ap_instance` switch, so any two run in parallel collide: `admin-blackout` + `blackout-clearance` already fail together and pass alone, and `realtime-blackout` and `blackout-read-paths` join that set. Triage these one file at a time; later stages' switch-flipping tests join it too.
- `loadMapForView` also backs `GET /api/map/[mapId]`, the client's on-error resync snapshot, so that route is a presence egress too and passes the viewer's account like the page does. Its payload also carries `blackout`.
- The location poll reads the live switch on every wormhole / abyssal tick, so the pre-existing `location-poll-jumps` / `connection-mass-log`-style fold assertions now fail if any switch-flipping Blackout file runs in parallel and leaves it on. `location-poll-blackout` holds the location-poll suite lock, which serializes it against the other `location-poll*` files but not against the other Blackout files.
- Hiding audit actors takes more than stripping the row fields: the `characterId` filter and `q`'s actor-name match would each let a restricted viewer attribute commits by narrowing the feed, so `hideActors` disables both. Rally embeds name their setter too, so `hideActor` covers them as well as history posts.
- `blackout-attribution` flips the switch, so it joins the parallel-collision set above. `webhook-dispatch` asserts no message text, so it is unaffected by a switch left on.
- A `/live` spectator page already open when Blackout turns on keeps the presence it last fetched until its next refetch: clearing the snapshot cache stops new reads, but nothing nudges public sockets on a flip, and Blackout itself suppresses the presence nudges. The frozen roster is pre-Blackout and goes no further; a `publicUpdate` on the flip would clear it but is outside every stage as written.
- The live Blackout standing is held by `RealtimeProvider` (app-wide, one per tab), not per map, so it survives soft navigation between maps; `useBlackoutStatus(initial)` only falls back to the page's value before the tab's first `healthCheck`. Anything reading it outside the map view needs only a `RealtimeProvider` ancestor.
- The connection-badge hover popover (`ConnectionDetailPopover`) also calls `fetchConnectionMassLog` and shows "logged mass" from `data[0]`; under Blackout a restricted viewer sees zero there rather than a hidden state. Outside Stage 8's touch list, left as is.
