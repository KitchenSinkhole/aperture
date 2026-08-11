# Map Settings Dialog — Audit Fixes

## Context

`docs/audits/map-settings-dialog.md` (2026-08-10) traced every control in the Map Settings dialog from the UI through the server gate, the DB column, and on to the consuming code. It found the transport layer sound and every server gate correct, but landed ten findings: four controls persist to columns nothing reads, three surfaces show controls to viewers who cannot use them, two Server Action families bypass the canonical guard, and a scatter of docblocks still name pre-R4 gate names.

I re-verified all ten independently. All confirmed. Two corrections to the audit's file references worth carrying into execution:

- `GeneralPanel` is **not** a separate file — it is a private function inside `MapSettingsDialog.tsx:210-274`, with no companion of its own.
- `MapAuditDialog` lives at `src/components/map/manage/MapAuditDialog.tsx`, not under `dialogs/`.

Decisions taken with the user for the four findings that needed a product call:

| Finding | Decision |
|---|---|
| 6 — `trackAbyssalJumps` inert | **Implement it.** Fold abyssal traversals as `scope='abyssal'` connections on maps with the flag set. |
| 7 — `logActivity` inert | **Remove it**, column and all. `ap_map_event` is also the realtime transport, so a flag that suppresses the write cannot exist without breaking live updates. |
| 8 — `icon` never rendered | **Drop the field and the column.** |
| 9 — `scope` never enforced | **Reword as descriptive.** Keep the column and the create-time choice; stop presenting it as a rule. No behavior change, no risk to the server-side fold path. |
| Test additions | **Add both.** |

Intended outcome: no control in the dialog persists to a column nothing reads, no surface offers an action that always fails, both Server Action families use the canonical guard, and the index docs match the code.

Each stage runs in its own fresh session.

---

## Stage 1 — Route the webhook and share actions through `requireMapCapability`

**Mode:** Execute
**Status:** done — 709e7b6c
**Goal:** Close Finding 3 — a delegated title-holder can currently mint share links and edit webhooks on a soft-deleted map that its own Director can no longer touch.

**References:** `src/lib/auth/rights.md`, `src/app/(app)/actions/webhooks.md`, `src/app/(app)/actions/mapShares.md`

**Touches:** `src/app/(app)/actions/webhooks.ts`, `src/app/(app)/actions/mapShares.ts` (+ companions)

The cause: both files gate on bare `canUseMapFeature`, whose `hasMapCapability` branch is an EXISTS over `ap_map_role_access ⋈ ap_character_role` that never loads the map row and so never sees `deleted_at`. `canManageMap` does load it (`rights.ts:251-283`) and correctly returns false. Result is inverted authority during the 30-day grace.

`requireMapCapability` (`rights.ts:455`) resolves session → `canViewMap` (which filters `isNull(deletedAt)`) → `canUseMapFeature`, and returns a `RightGuard` tuple. It never throws.

- `webhooks.ts` — rewrite the shared `gateForMap` helper (`:40-47`) to call `requireMapCapability(session, mapId, 'webhooks_manage')` and map the guard's `error` onto the file's local `ActionResult` shape. `gateForWebhook` (`:50-61`) already delegates to it, so all five actions inherit the fix.
- `mapShares.ts` — same for the `gate` helper (`:42-46`). It returns `bigint | null`; keep that shape so the three call sites are untouched.
- **Preserve `revokeMapShare`'s enumeration defence** (`:138-144`): it deliberately returns `'Share link not found.'` for both an unknown id and a forbidden one. The new guard's 403/404 distinction must not leak through here.

**Done when:** both helpers go through `requireMapCapability`; `pnpm lint && pnpm typecheck && pnpm build` pass; a manual read confirms `revokeMapShare` still returns an identical message on unknown-vs-forbidden.

---

## Stage 2 — Capability reveal and post-save refresh in the settings surfaces

**Mode:** Execute
**Status:** done — e45c069b
**Goal:** Close Findings 1, 2, 4 and 5 — three surfaces offer actions that always fail, and saved settings appear to revert.

**References:** `src/components/dialogs/MapSettingsDialog.md`, `src/components/map/manage/MapBehaviorForm.md`, `src/components/map/manage/MapTaggingForm.md`, `src/app/(app)/maps/page.md`, `src/lib/auth/rights.md`

**Touches:** `src/lib/auth/rights.ts`, `src/app/(app)/maps/page.tsx`, `src/components/dialogs/MapSettingsDialog.tsx`, `src/components/map/manage/MapBehaviorForm.tsx`, `src/components/map/manage/MapTaggingForm.tsx` (+ companions)

### Finding 1 — General tab is editable by viewers who cannot save it

`GeneralPanel` (inline, `MapSettingsDialog.tsx:210-274`) renders unconditionally, but `updateMapSettingsAction` requires `settings_manage` (`map.ts:185`). A plain corp member types a new name and gets a `Forbidden.` toast.

Do **not** hide the tab — it is `defaultValue="general"` and carries the read-only scope/visibility line, which is genuinely informational. Pass `canEdit={can('settings_manage')}` into `GeneralPanel`; when false, render the name as static text and omit the Save button entirely.

### Finding 2 — the `settings` prop never refreshes

`MapCanvas.tsx:2272` passes `settings` straight through from the server page; it is a prop, never state. Combined with `updateMapSettingsAction`'s `revalidatePath('/maps')` (the wrong route), `applyEvent` folding only `name`, and Base UI's `Dialog.Portal` defaulting to `keepMounted={false}`, every panel re-seeds from a stale prop on reopen.

Fix in the client: `router.refresh()` on a successful save in all three panels (`GeneralPanel`, `MapBehaviorForm`, `MapTaggingForm`). **`MapCanvas.tsx` has no `next/navigation` import today** — the `useRouter` calls belong in the panels themselves, not the canvas. Prefer this over adding a second `revalidatePath` in the action: the map route is a catch-all (`/map/[[...slug]]`) and revalidating it by path type is fragile.

### Finding 4 — Delete button on `/maps` ignores `map_delete`

`maps/page.tsx:51` renders `DeleteMapButton` on every viewable card with no check. The action refuses correctly (`map.ts:145`), so this is presentation-only — but `map_delete` is currently the one capability of seven whose delegation changes nothing visible.

The page has no capability data at all today. Add a batched helper to `rights.ts` rather than calling `canUseMapFeature` per card:

```ts
export async function mapsWithCapability(
  characterId: bigint, mapIds: bigint[], capability: MapCapability,
): Promise<Set<bigint>>
```

Three queries regardless of set size: actor (with the admin short-circuit), one `inArray` select over `ap_map` **left-joined to `ap_alliance`** so the executor corp resolves in the join instead of a per-map `executorCorpOf` round-trip, then one grant query over the maps not already allowed. Per-card `canUseMapFeature` costs 2–4 round-trips each with no memoization (`rights.ts` deliberately avoids `react.cache` so it can load under bare Node for `wsServer.ts`), so `Promise.all` would convert an N+1 into a burst of pool checkouts on every `/maps` render.

The ownership switch inside it must be a literal mirror of `canManageMap` (`rights.ts:259-282`) — same admin short-circuit, same director checks, same executor-corp equality. Cross-reference the two in comments; Stage 5 adds the test that asserts they agree.

In the page, hide the whole positioned wrapper (`page.tsx:50-52`), not just the button, so no dead hit-target survives in the card corner.

### Finding 5 — Roles tab appears where it can never work

Delegation is corp-map-only, so a private-map owner or alliance manager gets a tab whose entire content is "Feature delegation is available on corporation maps only." Add `settings.type === 'corp'` to **both** the tab trigger (`:83`) and the panel guard (`:137`).

**Done when:** the General panel renders read-only without `settings_manage`; the Roles tab is absent on private and alliance maps; `/maps` shows the delete affordance only where `map_delete` is held; all three settings panels call `router.refresh()` on success; CI passes.

---

## Stage 3 — Retire `icon` and `log_activity`

**Mode:** Execute
**Status:** done — 73e3a553
**Goal:** Close Findings 7 and 8 — remove two columns that nothing reads, `log_activity` being a privacy-shaped promise the system does not keep.

**References:** `src/db/schema/ap/map.md`, `src/app/(app)/actions/map.md`, `src/lib/map/transfer.md`, `src/lib/map/loadMap.md`, `src/lib/realtime/protocol.md`

**Touches:** new migration `0068_*`, `src/db/schema/ap/map.ts`, `src/app/(app)/actions/map.ts`, `src/app/(admin)/actions/maps.ts`, `src/lib/realtime/protocol.ts`, `src/lib/map/loadMap.ts`, `src/lib/map/transfer.ts`, `src/components/dialogs/MapSettingsDialog.tsx`, `src/components/map/manage/MapBehaviorForm.tsx`, `src/components/maps/CreateMapDialog.tsx`, two test fixtures (+ companions)

`log_activity` is unimplementable as labelled: `commitMapEvent` (`mutations/core.ts:77-122`) writes `ap_map_event` unconditionally, and the `fn_map_event_notify` trigger (`0004_map_schema.sql:115`) turns every such row into the `pg_notify` that *is* the realtime transport. A flag that suppresses the write suppresses live updates. `icon` is written by the General tab and read into three typed shapes, and no `.tsx` in the repo renders it — the placeholder suggests `fa-home` and the stack has no FontAwesome.

Both are `NOT NULL DEFAULT true` / nullable-text respectively, born in migration 0004, never consumed.

Sweep, in dependency order:

1. **Migration `0068`** — `ALTER TABLE ap_map DROP COLUMN icon, DROP COLUMN log_activity;`. Generate with `drizzle-kit generate` (working again since the 0058 rebaseline) after the schema edit; **hand-write the `.rollback.sql`** re-adding both with their original definitions. Latest on disk is `0067_sde_ingest_stage`.
2. **Schema** — `src/db/schema/ap/map.ts:20` (`icon`) and `:24` (`logActivity`), plus `map.md`.
3. **Write paths** — `(app)/actions/map.ts`: create zod `:40`, update zod `:46`/`:50`, insert `:69`, `map.create` payload `:126`/`:131`, update set `:206`/`:213`. `(admin)/actions/maps.ts:136`, `:187` (`logActivity` only; admin never touched `icon`).
4. **Realtime zod** — `protocol.ts:404`, `:411` (`icon` on `map.create`/`map.update`), `:415` (`logActivity`).
5. **Read paths** — `loadMap.ts`: `MapListItem:232`, `MapSettings:238`/`:246`, `AdminMapListItem:266`, and the selects at `:498`, `:504`, `:611`, `:635`, `:651`.
6. **Export** — `transfer.ts:113`/`:117` (schema) and `:149`/`:153` (select). Zod strips unknown keys, so previously-exported files still import; per CLAUDE.md no compatibility shim is wanted.
7. **UI** — the Icon `<Input>` and its state in `GeneralPanel` (`MapSettingsDialog.tsx:212`, `:225`, `:248-258`), the `logActivity` toggle in `MapBehaviorForm.tsx:13`, `:31`, and its pass-through at `MapSettingsDialog.tsx:101`. Check `CreateMapDialog.tsx` for an icon field.
8. **Tests** — `tests/integration/map-import-export.test.ts:242-243` fixtures. `tests/unit/apply-event.test.ts:298` uses `logActivity` *specifically because* it is inert, asserting a `map.update` carrying only that field is a no-op reducer (`expect(next).toBe(state)`); swap it for another field `applyEvent` ignores, e.g. `deleteExpiredConnections`.

**Done when:** no `icon` or `logActivity` reference survives outside migration history and drizzle snapshots; `0068` and its rollback exist; CI passes. Applying the migration to the dev DB is a manual step (see below).

---

## Stage 4 — Implement `trackAbyssalJumps`

**Mode:** Execute
**Status:** done — 067d3d29
**Goal:** Close Finding 6 — make the toggle do what its label says: record abyssal traversals as connections on maps that opt in.

**References:** `src/lib/map/locationToConnection.md`, `src/lib/jobs/locationCommit.md`, `src/lib/jobs/tasks/locationPoll.md`, `src/db/schema/ap/map_connection.md`

**Touches:** `src/lib/jobs/tasks/locationPoll.ts`, `src/lib/jobs/locationCommit.ts`, `src/lib/map/locationToConnection.ts` (+ companions), the two integration tests that name the fold function

Today the toggle is not merely unread — the code documents the opposite as deliberate policy. `locationPoll.ts:228` folds only `jumpClass === 'wormhole'`; `locationToConnection.ts:29-32` states abyssal links are "never a real chain edge. We never map abyssal systems or their links." The toggle defaults to on.

Everything needed already exists: abyssal systems are real `universe_system` rows (`id >= 32000000`, `security = 'A'`, ingested unfiltered — `tests/db/universe-ingest.test.ts:76` asserts it), `connection_scope` already carries an `'abyssal'` value from migration 0004, and `SystemNode.tsx` / `styling.ts` already render class `A` (teal) and abyssal scope (orange). They have no stargate edges, so they add as a bare `system.added`.

1. **`loadActiveTrackedMaps`** (`locationPoll.ts:356-365`) — it already `innerJoin`s `apMap`; add `trackAbyssalJumps` to the select and return `{ mapId, trackAbyssalJumps }[]`. Leave `broadcastCharacterUpdate`'s `trackedMapIds: bigint[]` alone — fan-out has no business knowing about map behavior — and map to ids at the two call sites (`:168`, `:211`).
2. **The fold branch** (`:219-268`) — widen to `wormhole || abyssal`, derive `scope`, and `continue` past maps whose flag is off. One loop, not two copies of the body.
3. **`locationCommit.ts`** — rename `foldWormholeJumpOntoMap` → `foldJumpOntoMap` (it would otherwise be lying) and add a **required** `scope: 'wh' | 'abyssal'` to `FoldArgs`. Not optional-defaulting-to-`'wh'`: a silent default is the exact bug class being fixed. Thread it to the hard-coded `scope: 'wh'` at `:296` and into the two throw messages (`:249`, `:343`).
4. **Keep `ensureConnection`'s dedupe scope-agnostic** (`:253-271`). `ap_map_connection` has no unique index on `(map_id, source, target)` — this app-level check is the only thing preventing parallel duplicate edges, and the canvas, `removeSystem` and the inspector all assume one edge per pair. It also handles the common case for free: a filament run returns you to the entry system, so the poll sees `S → X` then `X → S`, and the bidirectional probe collapses them into one edge.
5. **Skip the mass log for abyssal.** Gate `logConnectionJump` (`:251`) on `scope === 'wh'`, and skip the `shipMass()` lookup entirely. The log answers "how much mass before this hole collapses"; a filament has no mass budget, cannot collapse, and `connectionState.ts:40` already returns no expiry for non-`wh` scopes. Gate on the scope, not on a null mass, or every abyssal jump trips `logConnectionJump`'s unresolved-mass warning.
6. **Gate `tagOnJump` on `scope === 'wh'`** (both call sites, `:82` and `:109`). ABC self-guards (`abc.ts:74` excludes `A`), but **0121 does not** — `scheme0121.ts:31-66` is positional and never consults `isTaggableClass`, so it would tag the abyssal node as a child of the entry system and then root the exit system under it, growing the chain numbering through a node that is not a real hop.
7. **Telemetry** — `FoldSummary` needs nothing (`PollNotes.jumpClass` is already 1:1 with the folded scope). Add `abyssalMapsSkipped?: number` to `PollNotes`, emitted only on abyssal ticks: without it, `folds: []` is indistinguishable between "tracked on no maps" and "every map has the flag off".
8. **Rewrite the policy docblock** at `locationToConnection.ts:29-32` and its companion, plus the affected lines in `locationCommit.md` and `locationPoll.md`.

**Known consequences — flag in `## Notes`, do not fix here.** A folded abyssal edge is permanent: `expiredConnections.ts:36` and `connectionState.ts:40` filter to `scope='wh'`, and `removeSystem` (`mutations/systems.ts:184`) dormants only `wh`, so removing the abyssal node leaves the edge `confirmed_at NOT NULL` and it can silently reappear if that system id is ever re-added. Repeated runs into the same abyssal system hang one more permanent edge per distinct entry system. Acceptable for a first cut of an opt-in toggle; reaping is a follow-up.

**Done when:** an abyssal jump folds a `scope='abyssal'` connection on a map with the flag set and folds nothing on a map without it; no mass-log row and no tag event is produced for it; wormhole folds are byte-identical to before; CI passes.

---

## Stage 5 — Copy, docblocks, and the two missing tests

**Mode:** Execute
**Status:** todo
**Goal:** Close Findings 9 and 10, and add the two tests whose absence let Finding 1 through.

**References:** `src/lib/auth/rights.md`, `src/lib/map/transfer.md`, `src/db/schema/ap/enums.md`, `tests/integration/permissions.ts` and `title-delegation.ts` companions

**Touches:** `src/components/dialogs/MapSettingsDialog.tsx`, `src/db/schema/ap/enums.ts`, `aperture.config.ts`, `src/lib/auth/rights.ts`, `src/lib/map/transfer.ts`, `src/lib/map/loadMap.ts`, `src/components/map/manage/{MapBehaviorForm,MapTaggingForm,MapWebhooksPanel,MapAuditDialog}.tsx`, `tests/integration/{permissions,title-delegation}.test.ts` (+ companions)

Run this stage **last** so the docs describe the finished state.

### Finding 9 — scope reads as a constraint it does not enforce

Keep the column and the create-time choice; stop claiming it is a rule.

- `MapSettingsDialog.tsx` — "Scope … and visibility … are fixed when the map is created and cannot be changed" is true of visibility (it drives every branch in `rights.ts`) and misleading of scope. Reword so scope reads as a descriptive label and visibility keeps its constraint language. **Stage 2 duplicated this paragraph**: `GeneralPanel` now has a read-only branch (viewer lacks `settings_manage`, currently ~line 253-257) and the editable form branch (currently ~line 277-281), each with its own copy of the sentence — reword both, not just one, or the two states will disagree. (Stage 3 removed the Icon input between the two branches, shifting both down from Stage 2's line numbers — grep for the sentence text rather than trusting either range.)
- `enums.ts:19` and `enums.md:15` — "what kinds of systems a map is allowed to hold" / "may hold" → descriptive.
- `aperture.config.ts:173` — `/** Per-scope ceilings for 'ap_map.scope'. */` is doubly wrong: the keys are `private`/`corp`/`alliance`, which is `ap_map.type`. Fix the comment.

### Finding 10 — gate names predating the R4 rework

- `MapSettingsDialog.tsx:29-30` and `MapSettingsDialog.md:23` say General saves under `map_update`. It is `settings_manage`. **This one inverts the meaning** — `map_update` is view-gated, so the doc reads as "any viewer can rename the map".
- `MapBehaviorForm.tsx:32` (shifted from `:35` by Stage 3's toggle-list trim — grep `canManageMap` to confirm) and `MapBehaviorForm.md:14`, `MapTaggingForm.tsx:29` say `canManageMap`; both are `settings_manage`.
- `MapWebhooksPanel.tsx:44` says `canManageMap`; it is `webhooks_manage`.
- `MapAuditDialog.tsx:13` and `MapAuditDialog.md:20` say the button renders for "`canManageMap` holders"; it is `capabilities.includes('audit_view')` (`MapCanvas.tsx:2233`).
- `rights.ts:167-170` and `:239-242` call title delegation "the future R4 overlay" directly above the shipped implementation; `rights.md:50` repeats "no per-right granularity at baseline".
- `transfer.ts:138-139` (shifted from `:140-141` by Stage 3's column removals) and `transfer.md:20` claim `buildMapExport` exports `intel_notes` "which `loadMapForView` omits". It selects them (`loadMap.ts:306`, `:417` — shifted from `:310`/`:421` by Stage 3's column removals). Delete the false clause.
- `loadMap.ts:482` (shifted from `:486` by Stage 3's column removals) says the dialog's Save re-checks `map_update`; it is `settings_manage`.
- Correct `docs/audits/map-settings-dialog.md` where this work invalidates it (Findings 6 and 7 in particular).

### Tests

- `tests/integration/title-delegation.test.ts` — extend the grant/revoke round-trip beyond `audit_view`: grant `map_export` via `setMapDelegation` and assert the holder gains **exactly** that capability (and, per Stage 2, that `mapsWithCapability` agrees with per-id `canUseMapFeature` across the private / corp / alliance / role-grant matrix).
- `tests/integration/permissions.test.ts` — assert a plain corp member who can view a map cannot save the General tab: `updateMapSettingsAction({ mapId, name })` returns `Forbidden.`. Nothing asserts this today, which is why Finding 1 went unnoticed.

**Done when:** no docblock or companion names a pre-R4 gate; both tests exist and pass under `RUN_DB_TESTS=1`; CI passes.

---

## Verification

**Mechanical gate, every stage:** the `ci-verifier` agent (`pnpm lint`, `pnpm typecheck`, `pnpm build`, in that order). Note `pnpm build` intermittently fails with an "inferred workspace root" error under Turbopack — retry once before treating it as real.

**DB-backed tests** need the dev database, which the audit could not reach: `aperture-db-1` was stopped and host port 5432 was held by an unrelated project's container, so `DATABASE_URL` resolved elsewhere and global setup failed with `28P01`. Free the port, start `aperture-db-1`, export `DATABASE_URL` from `.env` manually, then run in isolation (the full suite is flaky under parallelism):

```
RUN_DB_TESTS=1 npx vitest run tests/integration/permissions.test.ts tests/integration/title-delegation.test.ts
RUN_DB_TESTS=1 npx vitest run tests/integration/map-import-export.test.ts tests/integration/connection-mass-log.test.ts tests/integration/auto-tagging.test.ts
```

**Migration (Stage 3):** apply with `pnpm db:migrate` against the running dev DB. If it fails with "type X already exists", a prior migration was applied via `psql` without a ledger row — reconcile by inserting the `drizzle.__drizzle_migrations` row rather than editing the migration.

## Manual verification

_(worked by the user once, after the run — the plan is not complete until it passes)_

- **Stage 2** — As a plain corp member on a corp map: open Settings. The General tab shows the name as static text with no Save button; Behavior, Auto-tagging, Webhooks, Share links, Export, Import and Roles are all absent. On `/maps`, no trash icon appears on any card you cannot delete.
- **Stage 2** — As a manager: toggle "Delete EOL connections" off, Save, close the dialog, reopen it. The checkbox stays off. Repeat for the tagging scheme and the map name.
- **Stage 2** — As a private-map owner and again as an alliance manager: the Roles & Permissions tab is absent.
- **Stage 4** — With a tracked character, take a filament into abyssal space and back on a map with "Track abyssal jumps" on: the abyssal system appears with the orange abyssal edge, no mass-log entry, no auto-tag. Repeat on a map with the toggle off: nothing appears.
- **Stage 4** — Confirm an ordinary wormhole jump still folds identically, with its mass-log entry and its 0121 child tag.

## Notes

_(appended by executing sessions — non-obvious findings only)_

- **Stage 1** — Both `gateForMap` (webhooks.ts) and `gate` (mapShares.ts) call `requireSession()` first, which itself redirects on no-session/inactive-character before `requireMapCapability` ever runs. `requireMapCapability`'s `401` branch is therefore unreachable from these two call sites by construction — only its `404` (view) and `403` (capability) branches are live here. Not a bug, just means the two helpers can never surface `'Unauthorized.'`.
- **Stage 2** — `GeneralPanel`'s new `!canEdit` branch is a second render path, not a disabled version of the form, so it carries its own copy of the scope/visibility disclaimer paragraph. Stage 5's Finding 9 reword now has two occurrences to fix in that function, not one; the plan text above was updated to say so.
- **Stage 2** — Editing `MapSettingsDialog.tsx` (new imports, the read-only branch, the docblock) and `MapBehaviorForm.tsx` (new import + `router` line) shifted several of Stage 3 and Stage 5's cited line numbers by a handful of lines (e.g. the `map_update` docblock mention is now `:31` not `:30`; the `logActivity` `TOGGLES` entry is now `:32` not `:31`). Not re-verified line-by-line across every stage — grep for the symbol (`icon`, `logActivity`, `map_update`, `canManageMap`) rather than trusting a stage's line number literally, the usual staleness risk with line-anchored references.
- **Stage 2** — `mapsWithCapability`'s ownership pass filters `isNull(apMap.deletedAt)` even though `/maps` (its only caller) already excludes soft-deleted maps via `listViewableMaps`. Kept for defense-in-depth / future callers rather than relying on the caller's filter, matching `loadMap`'s pattern elsewhere in `rights.ts`.
- **Stage 4** — A folded abyssal edge is permanent: `expiredConnections.ts:36` and `connectionState.ts:40` filter to `scope='wh'`, and `removeSystem` (`mutations/systems.ts:184`) dormants only `wh`, so removing the abyssal node leaves the edge `confirmed_at NOT NULL` and it can silently reappear if that system id is ever re-added. Repeated runs into the same abyssal system hang one more permanent edge per distinct entry system. Acceptable for a first cut of an opt-in toggle (default on); reaping dormant/orphaned abyssal edges is a follow-up, not fixed in this stage per the plan's own instruction. Stage 4 touched only `locationPoll.ts`, `locationCommit.ts`, `locationToConnection.ts` and the two integration tests naming the fold function — none of Stage 5's cited files or line numbers, so no downstream reconciliation was needed.
