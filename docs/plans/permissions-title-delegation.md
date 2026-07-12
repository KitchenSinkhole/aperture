# Per-Title Map Feature Delegation (R4)

**Goal:** Let a corp director delegate individual director-gated map features (audit log, settings, webhooks, import, export, delete) to specific EVE corporation titles, per map, by extending `ap_map_role_access` with a capability column.

**References:** `src/lib/auth/rights.ts` (+ `rights.md`), `src/db/schema/ap/role.ts`, `src/db/schema/ap/enums.ts`, `src/lib/auth/syncCharacterAuthz.ts`, `src/components/dialogs/MapSettingsDialog.tsx`, `src/components/map/MapCanvas.tsx`, CLAUDE.md (migrations hand-written since 0011; companion `.md` standing instruction; Server Actions for low-frequency config; audit-log is an accountability tool).

---

## Context

This is the reserved **R4 title-delegation overlay** from the permissions multi-tenant rework — the substrate was deliberately left standing (see `docs/plans/permissions-multitenant.md`, migration `0041`). Today every director-gated map feature funnels through a single binary `canManageMap` (admin / private owner / owning-corp Director / owning-alliance executor-corp Director). There is no way for a director to hand *one* feature (e.g. "view the audit log") to a subset of corp members without making them a full Director.

Issue **#210 ("Information Blackout")** is the motivating consumer: it needs "who can toggle intel blackout" and "who still sees pilots during blackout" to be grantable to specific people. Those are just two more capabilities on top of a general delegation framework. This plan builds that framework and wires the **existing** director features through it; the #210 blackout feature itself is a follow-up that adds `blackout_toggle` / `intel_view` capability values and the realtime filtering.

The delegatable target is an EVE **corporation title** — already mirrored into `ap_role` (`source='corp_title'`, `corporation_id`, `external_ref='<corp_id>:<title_id>'`) and kept in sync per-character by `syncCharacterAuthz`. A character holds a title via `ap_character_role`. So "grant a feature to a title" = write `(map_id, role_id, capability)` into `ap_map_role_access`.

**Scope decision (persist this):** delegation is a **corp-map feature** in v1. The capability model is deliberately corp-agnostic (it is just `role_id → capability`), so the alliance extension is purely: (a) which titles are eligible to list for an alliance map, and (b) resolving a viewer's titles across member corps. Private maps have no titles and show the tab as unavailable. **This corp-first / alliance-extensible decision must be recorded in the repo** — see Stage 3 deliverables (docs/plans note + `role.md` companion + a memory).

**Delegatable set (confirmed):** all six director features individually. Every director/owner/admin keeps all capabilities *implicitly*; delegation only grants to titles.

---

## Capability model

New `pgEnum('map_capability', …)`:

```
view              -- the existing role→map view overlay (backfill target for current rows)
audit_view        -- GET the audit log
settings_manage   -- edit name/icon/behavior flags/auto-tagging
webhooks_manage   -- create/update/delete/test webhooks
map_import         -- import map data
map_export         -- export map data
map_delete         -- delete the map
```

- `ap_map_role_access` gains `capability map_capability NOT NULL`; PK becomes `(map_id, role_id, capability)`.
- **View unchanged:** any `ap_map_role_access` row for a role the viewer holds still implies view — the read paths (`hasRoleAccess`, `viewableMapPredicate`) match on `role_id` with no capability filter, so a feature grant implies visibility (you cannot delegate audit for a map the title cannot see). Existing rows backfill to `capability='view'`.
- **Manager implication:** feature gates are `canManageMap(actor, map) OR <role holds the capability>`. A director never needs an explicit grant.
- **Multiple titles per character:** a character holds each corp title as its own `ap_character_role` row. Capabilities are **additive — the union across every title the viewer holds** (most-permissive wins; there are no deny-grants). `hasMapCapability` is an `EXISTS` over held roles; `resolveMapCapabilities` unions across them. This is the same multi-role join the existing view overlay already relies on.

Why a **new enum** rather than reusing `map_right`: `map_right` (`map_create/map_update/map_delete/map_import/map_export/map_share`) is the coarse mutate-guard argument — it includes non-delegatable, non-per-map values (`map_create`, `map_update` is view-gated content editing, `map_share`) and has no `audit_view`/`settings_manage`/`webhooks_manage`. A dedicated `map_capability` enum names exactly the per-map delegatable surface and keeps invalid rows unrepresentable. `map_right` stays as-is (still routes `map_update`/`map_create`).

---

## Stage 1 — Schema + capability resolver
**Mode:** Accept edits
**Goal:** The capability column exists and `rights.ts` can answer "does this character have capability X on this map".
**Touches:** `src/db/migrations/0056_map_role_capability.sql` (+ `.rollback.sql`, `_journal.json` idx 56), `src/db/schema/ap/enums.ts`, `src/db/schema/ap/role.ts`, `src/types/index.ts`, `src/lib/auth/rights.ts`, and their companion `.md` files.

- **Migration `0056_map_role_capability`** (hand-written pair; apply before running tests, `DATABASE_URL` exported from `.env`):
  ```sql
  CREATE TYPE "public"."map_capability" AS ENUM ('view','audit_view','settings_manage','webhooks_manage','map_import','map_export','map_delete');
  ALTER TABLE "ap_map_role_access" ADD COLUMN "capability" "map_capability" NOT NULL DEFAULT 'view';
  ALTER TABLE "ap_map_role_access" DROP CONSTRAINT "ap_map_role_access_pk";
  ALTER TABLE "ap_map_role_access" ADD CONSTRAINT "ap_map_role_access_pk" PRIMARY KEY ("map_id","role_id","capability");
  ALTER TABLE "ap_map_role_access" ALTER COLUMN "capability" DROP DEFAULT;
  ```
  Keep the `ap_map_role_access_role_id_idx` index. Rollback reverses: recreate PK on `(map_id,role_id)`, drop column, drop type (all `IF EXISTS`). Follow the `0050`/`0054` doc-comment + `--> statement-breakpoint` format; append the journal entry.
- **Schema:** add `mapCapability` pgEnum in `enums.ts`; add `capability: mapCapability('capability').notNull()` to `apMapRoleAccess` and change `primaryKey` to `{ columns: [t.mapId, t.roleId, t.capability] }`. `ApMapRoleAccess`/`NewApMapRoleAccess` auto-update; add `export type MapCapability = (typeof mapCapability.enumValues)[number]` to `types/index.ts`.
- **`rights.ts` new exports:**
  - `hasMapCapability(characterId, mapId, capability): Promise<boolean>` — EXISTS a row `(map_id, role_id, capability)` where the character holds `role_id` (join `ap_character_role`). Mirror the `hasRoleAccess` query with an added `capability` predicate.
  - `canUseMapFeature(characterId, mapId, capability): Promise<boolean>` — `canManageMap(...) || hasMapCapability(...)`. The single resolver every feature gate calls.
  - `requireMapCapability(session, mapId, capability): Promise<RightGuard>` — session (401) → `canViewMap` (404) → `canUseMapFeature` (403). The tuple guard for API routes / actions, matching `requireMapManage`'s shape.
  - `resolveMapCapabilities(characterId, mapId): Promise<Set<MapCapability>>` — manager → all values; else → the set of capabilities the character's roles grant on the map (one query). Feeds the client reveal in Stage 2.
  - Keep the `server-only`-free note; every helper stays read-only.
- Update `rights.md`, `role.md`, `enums.md`, `types/index.md` companions (new symbols / column / PK / enum).

**Done when:** migration applies cleanly to the dev DB; `pnpm typecheck` green; a focused integration test confirms `hasMapCapability`/`canUseMapFeature` (grant a corp-title role `audit_view` on a corp map → true for a holder, false for a non-holder, true for a manager without any grant).

---

## Stage 2 — Route the existing director features through capabilities
**Mode:** Accept edits
**Goal:** Each director feature is gated by its specific capability (manager still passes implicitly), and the client learns which capabilities the viewer holds.
**Touches:** `src/app/api/map/[mapId]/audit/route.ts`, `src/app/api/map/[mapId]/webhooks/route.ts`, `src/app/(app)/actions/webhooks.ts`, `src/app/(app)/actions/map.ts`, `src/app/api/map/[mapId]/import/route.ts`, `src/app/api/map/[mapId]/export/route.ts`, `src/app/(app)/map/[[...slug]]/page.tsx`, and companions.

- Swap each gate from the binary `canManageMap`/management path to `requireMapCapability(session, mapId, <capability>)`:
  - audit GET → `audit_view` (replaces the explicit `canManageMap` 403 at `audit/route.ts:50`).
  - webhooks GET + `gateForMap` in `webhooks.ts` → `webhooks_manage`.
  - `updateMapSettingsAction` → `settings_manage` (replaces `requireMapManage`).
  - import route → `map_import`; export route → `map_export` (replace `requireMapMutate(..., 'map_*')`).
  - `deleteMapAction` → `map_delete` (replaces `requireMapRight(..., 'map_delete')`).
  - `map_update` content-editing routes are untouched (still view-gated via the existing `requireMapMutate('map_update')` path).
- **`page.tsx`:** alongside `canManage`, call `resolveMapCapabilities(characterId, mapId)` and pass the viewer's capability set to `MapCanvas` (new prop, e.g. `capabilities: MapCapability[]`). `canManage` stays (still governs the Roles & Permissions tab and management framing).

**Done when:** integration tests cover delegated access end-to-end — a title-holder with only `audit_view` gets 200 on audit but 403 on webhooks/settings/import/export/delete; a manager passes all; a plain viewer gets 403 on every feature but still 200 on view/read. CI green (`pnpm lint && pnpm typecheck && pnpm build`). Note the DB suite is parallel-flaky — triage new failures in isolation; snapshot/restore any global rows touched.

---

## Stage 3 — Roles & Permissions UI + delegation actions
**Mode:** Plan mode
**Goal:** A director opens a map's settings, sees the owning corp's titles, and toggles capabilities per title; delegated title-holders then see the features they were granted.
**Touches:** new `src/app/(app)/actions/mapRoles.ts` (+ `.md`), new `src/components/map/manage/MapRolesForm.tsx` (+ `.md`), `src/components/dialogs/MapSettingsDialog.tsx`, `src/components/map/MapCanvas.tsx`, and companions.

- **Server Actions (`mapRoles.ts`, low-frequency config → Server Action):**
  - `getMapDelegationState(mapId)` — gated by `canManageMap`. Returns the owning corp's `corp_title` roles (**first `ap_role`-by-`corporation_id` read** — filter `source='corp_title'` AND `corporation_id = map.owner_corporation_id`, backed by `ap_role_corporation_id_idx`) joined with current `ap_map_role_access` grants for the map. For non-`corp` maps, return an "unavailable in v1" marker.
  - `setMapDelegation(mapId, roleId, capability, enabled)` — gated by `canManageMap`; insert/delete the `(map_id, role_id, capability)` row (`view` is never toggled here — it is implied by any feature grant). Write one `ap_map_event` per change (delegation is accountability-relevant per the audit-log memory: name the title and capability, e.g. "granted <title> audit-log access"). No canvas realtime broadcast needed.
- **UI:** add a **Roles & Permissions** tab to `MapSettingsDialog` (gated by `canManage`, alongside Behavior/Auto-tagging/Webhooks). `MapRolesForm` renders a title × capability checkbox matrix; corp maps only (private/alliance show the unavailable note). MapCanvas reveals per capability from the Stage-2 `capabilities` prop: audit button ← `audit_view`; settings management tabs ← `settings_manage`; Webhooks tab ← `webhooks_manage`; Export/Import ← `map_export`/`map_import`; the Roles & Permissions tab itself stays `canManage`-only.
- **Persist the corp-first decision in the repo:** this plan lives at `docs/plans/permissions-title-delegation.md`; note the alliance-extension seam in the `role.md` companion, and write a memory (`title-delegation-corp-first`) recording that R4 shipped corp-scoped and the two things alliance support must add.

**Done when:** manual verification — as a corp Director, grant `audit_view` to a title in Roles & Permissions; log in as a character holding that title (and no Director role); confirm the audit log button appears and opens, while webhooks/settings stay hidden and their endpoints 403. As a title-holder without the grant, confirm no audit access. CI green.

---

## Verification (whole feature)
- **Migration:** `psql "$DATABASE_URL" -f src/db/migrations/0056_map_role_capability.sql` applies; rollback file reverses cleanly on a scratch DB.
- **Automated:** extend `tests/integration/permissions.test.ts` / `derived-authority.test.ts` with the delegation matrix (holder vs non-holder vs manager, per capability). Run with `RUN_DB_TESTS=1` and `DATABASE_URL` exported; pin `Math.random` only where a test hits sampling paths.
- **Manual E2E:** the Stage 3 director→title-holder walkthrough above, exercised in the running app.
- **Follow-up (out of scope):** #210 Information Blackout adds `blackout_toggle` + `intel_view` capability values to `map_capability` and the realtime pilot/position filtering — it plugs into this framework with no schema change beyond the two enum values.
