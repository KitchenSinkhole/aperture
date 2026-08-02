# Public Map Share (Spectator View)

**Goal:** Publish a read-only, redacted, live view of a map at an unguessable URL that needs no login, designed to double as the public launch showcase for Aperture.

**References:**
- `src/lib/auth/rights.md` (`map_share` right, `canManageMap`)
- `src/lib/map/loadMap.md` (`loadMapForView`, `MapViewData`, `loadMapPresence`)
- `src/lib/realtime/wsServer.md` (upgrade auth, `subscribe` gating)
- `src/components/map/MapCanvas.md` (props, presentation components)
- `src/app/api/map/README.md` (mutation pathway contract)
- CLAUDE.md: Mutation pathways, Realtime, Database, Lifecycle patterns

---

## Decisions taken

| Axis | Decision |
|---|---|
| Framing | General share-link feature (per-map named tokens, expiring, revocable, many active). The event is the first user. |
| Pilot presence | Per-token setting: `none` / `anonymous` / `full`. |
| Rendering | Dedicated spectator view, built to launch quality. Carries links to the public instance and the repo plus short project copy. |
| Realtime | Token-authed WebSocket with a polled-snapshot fallback. |

## Design invariants

These are the load-bearing rules. A stage that breaks one is wrong even if it ships.

1. **Redaction is server-side and type-enforced.** The public route serves a `PublicMapViewData` type that structurally cannot represent an intel note, a map note, structure intel, an audit entry, or per-row character attribution. Never ship a field to an anonymous client and hide it in CSS. If the type cannot carry it, no later refactor can leak it.
2. **The public loader is a separate function from `loadMapForView`.** Every authed read path is keyed `(characterId, mapId)`. Do not invent a synthetic anonymous character to reuse them.
3. **The public socket is pinned at upgrade.** A share token resolves to exactly one map id at upgrade time. A public socket's `subscribe` frames are never trusted to select a map.
4. **Public realtime carries no map data.** Public sockets receive a coarse "changed" nudge; the client refetches the redacted snapshot. There is exactly one code path that emits public map data.
5. **The snapshot is viewer-independent.** Unlike every authed page, one cached render serves every viewer of a token. This is what makes a large anonymous audience survivable, so the cache is a correctness-relevant part of the design, not an optimisation.
6. **Sharing is visible and revocable.** A map with a live share shows a persistent in-app indicator, and create/revoke land in the audit log naming the token label.

## Redaction profile

| Data | Public | Note |
|---|---|---|
| Systems, positions, class, region, status | always | the invite |
| Connections, scope, mass state, EOL | always | |
| Kill stats / zKB | per-token flag, default on | already public data |
| Signatures (full per-system list) | per-token flag, default **off** | unscanned IDs advertise where you have not looked |
| Connection endpoint sig IDs | separate per-token flag, default **off**, **on for the event token** | the 3-char code at each end of an already-visible wormhole. Saves guests re-scanning their way in. Discloses nothing about unscanned sigs or cosmic sites, so it is deliberately independent of the full-signature flag. |
| Pilot presence | per-token enum `none`/`anonymous`/`full`, default `anonymous` | `anonymous` = per-system counts, optionally hull-class buckets, no names |
| Intel notes, map notes, structure intel | never | |
| Attribution (lock holder, sig author, note author) | never | leaks roster composition even when content is safe |
| Rally points, tags, audit, webhooks, settings | never | |

---

## Stage 1 — Share token model

**Mode:** Plan mode
**Goal:** Persist share tokens and resolve them, with no UI and no public route yet.
**Touches:** `src/db/schema/ap/enums.ts`, `src/db/schema/ap/mapShare.ts` (new), `src/db/migrations/`, `src/types/index.ts`, `src/lib/map/share.ts` (new)

- New `ap_map_share`: identity id, `map_id` FK → `ap_map` `ON DELETE CASCADE`, `token` (unique, unguessable, generated server-side), `label`, `presence_mode`, `show_signatures`, `show_kill_stats`, `expires_at timestamptz`, `revoked_at timestamptz`, `show_connection_sig_ids`, `created_by_character_id` FK → `ap_character` `ON DELETE SET NULL`, `created_at timestamptz`.
- New `pgEnum('share_presence_mode', ['none','anonymous','full'])`.
- Lifecycle follows CLAUDE.md: no generic `active` boolean. Live = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())` and the parent map is not soft-deleted.
- `resolveShareToken(token)` returns the map id plus the redaction profile, or `null`. Constant-ish work on miss; do not leak existence through timing or status codes.
- Un-hide `map_share` in the rights layer: creating and revoking a share requires `canManageMap`.

**Done when:** migration and rollback apply cleanly, and unit tests cover live, expired, revoked, and soft-deleted-parent tokens.

## Stage 2 — Redacted projection

**Mode:** Plan mode
**Goal:** One server-side function turning a token into exactly the data the public may see.
**Touches:** `src/lib/map/loadPublicMap.ts` (new), `src/types/index.ts`

- `loadPublicMapView(token)` → `PublicMapViewData | null`.
- `PublicMapViewData` is a distinct type, not a `Partial<MapViewData>` or an `Omit<...>`. It has no field capable of carrying a redacted value.
- Presence projection branches on `presence_mode`: `none` omits the roster entirely, `anonymous` emits per-system counts (and optional hull-class buckets) with no names or character ids, `full` emits the roster minus account linkage (`userId`, `mainCharacterId`). Every mode filters to pilots whose system is actually visible on the map — `loadMapPresence` deliberately returns tracked pilots wherever they currently are (their system need not be on the map), and publishing a location off the visible chain would leak fleet activity a public link was never meant to expose.
- Signature inclusion branches on the per-token flag. **Kill stats are out of scope for this stage** — `show_kill_stats` stays persisted and unread; no `stats` field exists on `PublicMapViewData` and `statsForSystems` is not called from the public path. Revisit when a stage actually wires kill data into the public view.
- **Connection endpoint sig IDs.** When `show_connection_sig_ids` is set, the public connection edge carries `sourceSigId` and `targetSigId` (each `string | null`), derived server-side from `ap_map_signature` rows where `map_connection_id` matches, mapped to whichever endpoint each row's `map_system_id` belongs to. These ride on the **edge**, not in a signature list, so the field is available with the full-signature flag off. Only `wh`-scope connections can carry them; k-space gates always emit null.
- Either end may legitimately be null when the far side has not been pasted yet. Null means "not known to the map", and the projection must not conflate that with "no sig".
- **System tag vs. alias.** The ABC chain `tag` is published (it's a scheme-generated navigation label, not operator free text); the `alias` is redacted (it's operator-typed and routinely carries intent, e.g. "Staging").

**Done when:** integration tests assert, for each presence mode and flag combination, that the serialised payload contains no character name (outside `full`), no intel note, no map note, no structure intel, no system alias, and no attribution field. A revoked or expired token returns `null`. With `show_connection_sig_ids` off, no `sigId` value appears anywhere in the payload; with it on, a connection scanned from one side only exposes exactly one of the two codes.

## Stage 3 — Public route and snapshot endpoint

**Mode:** Accept edits
**Goal:** A real token renders a static map in a logged-out browser.
**Touches:** `src/app/(public)/live/[token]/page.tsx`, `src/app/(public)/live/[token]/layout.tsx`, `src/app/api/public/[token]/snapshot/route.ts`

- Route lives in the existing `(public)` group, which does not call `requireSession()`. Its own layout gives the spectator view a full-bleed shell without the app header and footer.
- `GET /api/public/[token]/snapshot` returns `PublicMapViewData` behind a short in-process LRU TTL (a few seconds), keyed by token. Viewer-independent, so one render serves everyone.
- `noindex` on the page, and rate limiting on the snapshot route.
- Invalid, expired, and revoked tokens all render the same 404, never distinguishing which.

**Done when:** a hand-minted token renders the map with no session and no console errors; revoking it 404s the page on reload.

## Stage 4 — Spectator UI

**Mode:** Plan mode
**Goal:** The launch-quality view. This is the promo surface, so it gets real design attention.
**Touches:** `src/components/public/` (new), reusing node and edge presentation from `src/components/map/`

- Reuse the node and edge components; import none of the interaction layer (no inspector, no paste hotkeys, no context menus, no per-account prefs).
- Built for an audience, not an operator: auto-fit to the chain, legible at stream resolution, no sidebars, generous type.
- **Entrances panel:** the currently-mapped k-space entrances into the chain with jump counts from the nearest hub, each listed with the sig ID to scan in the k-space system when it is known. That turns the panel from "here is the system" into a complete set of directions, which is the single most useful thing on the page for a guest.
- **Connection sig tags:** hovering a wormhole connection reveals a small tag at each end showing the abbreviated 3-char sig ID, positioned against its own endpoint node so it is unambiguous which code to look for in which system (the two ends of one hole have different codes). Ends with no known sig render as explicitly unknown rather than blank, so a guest can tell "nobody has scanned this side" from "the tag failed to load". Tags appear only when the token enables them; with the flag off the hover affordance is absent entirely, not empty.
- **Promo surface:** slim persistent bar with links to the public instance and the repo, plus a dismissible intro card carrying the project copy. Tasteful, not a banner.
- **Social unfurl:** OG and Twitter meta so a link pasted into Discord or Reddit renders a card. A dynamic OG image rendering the actual chain (Next.js `ImageResponse`) is a strong demo for modest effort.
- Load the `frontend-design` skill before starting this stage.

**Done when:** the page reads well at 1280x720 and on mobile, the unfurl renders correctly, and no redacted field appears anywhere in the DOM.

## Stage 5 — Realtime

**Mode:** Plan mode
**Goal:** The public view updates live, and degrades safely under load.
**Touches:** `src/lib/realtime/wsServer.ts`, `src/lib/realtime/protocol.ts`, `src/components/public/`

- Second auth branch at upgrade: a share token in the upgrade URL resolves via `resolveShareToken` and pins the socket to that one map. Session-cookie auth is unchanged.
- Public sockets receive a coarse nudge envelope carrying no map data. The client debounces and refetches the snapshot, which is cached, so a burst of edits collapses into few reads.
- Per-token connection cap and per-IP rate limit at upgrade. On cap, the client falls back to polling the snapshot endpoint.
- Revoking a token closes its live sockets.

**Done when:** two logged-out browsers see an edit within the debounce window; exceeding the cap silently degrades to polling; revocation disconnects and 404s.

## Stage 6 — Share management UI

**Mode:** Accept edits
**Goal:** Managers can mint, configure, and kill shares without touching the DB.
**Touches:** `src/components/map/` settings surface, `src/app/(app)/actions/` share actions

- Management dialog behind `canManageMap`: create a labelled token, set the redaction profile, copy the link, set an expiry, revoke.
- Persistent, unmissable in-map indicator whenever the map has a live share.
- Audit entries on create and revoke, naming the token label and the profile. Intent-level, per the audit-log convention.
- Permissions to manage share tokens are grantable per-title in the Roles & Permissions section of map settings.

**Done when:** a manager can run the whole lifecycle from the UI, and the audit log reads precisely.

## Stage 7 — Launch readiness

**Mode:** Plan mode
**Goal:** Confirm the public instance survives being advertised.
**Touches:** deployment, no application code expected

- Re-verify the three public-deployment blockers against the actual prod box rather than assuming: `ap_job_run` growth is bounded, no zombie location-poll backlog, killmail fetches sit far under the shared ESI bucket.
- Load-test the snapshot cache at the audience size you expect if the link reaches r/Eve.
- Confirm the public instance is deployed, the domain resolves, and the share URL is short enough to read off a stream overlay.

**Done when:** measured headroom at target audience, with the cut-off point known.

---

## Cut line

Stages 1 to 5 are the minimum for the event. Stage 6 is operator convenience (a token can be minted by hand). Stage 7 is not optional before advertising the link publicly.

## Still open

- **Event date**, which decides how much of Stage 4 is affordable.
- **Design direction** for the spectator view: an extension of Aperture's existing look, or a more dramatic broadcast aesthetic.
- **Broadcast delay.** Publishing the chain live means an adversary sees your rolls as you make them. A configurable delay is a standard streamer tool and the data model already supports it (serve the snapshot as of `now() - delay` from `ap_map_event`). Deferred, but worth deciding before the event rather than during it.
