# Map Settings Dialog Audit

**Date:** 2026-08-10
**Scope:** `src/components/dialogs/MapSettingsDialog.tsx`, the five panels it hosts (`src/components/map/manage/*`), every Server Action and API route behind them, and the authorization chain that gates each one.
**Method:** static trace of every control from the UI through the server gate, the DB column, and on to the consuming code. Grep coverage included `.ts`, `.tsx`, `.sql` migrations and trigger bodies, so a flag read only in plpgsql would not have been missed.

**Verdict in one line:** the plumbing is sound and every server gate is correct, but four controls persist to columns nothing reads, and three surfaces show controls to viewers who cannot use them.

---

## Summary of findings

| # | Finding | Severity |
|---|---|---|
| 1 | General tab is shown and editable to viewers who cannot save it | Medium |
| 2 | The `settings` prop never refreshes, so saved values appear to revert | Medium |
| 3 | Delegated title-holders outlive managers on a soft-deleted map | Low |
| 4 | Delete button on `/maps` ignores `map_delete` entirely | Low |
| 5 | Roles & Permissions tab appears on maps where it can never work | Low |
| 6 | `Track abyssal jumps` is inert, and contradicted by the code | Medium |
| 7 | `Log activity` is inert | Medium |
| 8 | Map `icon` persists but is never rendered | Low |
| 9 | Map `scope` is presented as a constraint but is never enforced | Low |
| 10 | Companion and docblock drift on the gate names | Cosmetic |

Export and import gating was checked separately and in depth. It is correct. See Part 3.

---

## Part 1: Wiring and permissions

Every tab reaches a real, matching server endpoint. Nothing is a dead control at the transport layer.

| Tab | Client | Server | Gate |
|---|---|---|---|
| General | `GeneralPanel` | `updateMapSettingsAction` | `requireMapCapability('settings_manage')` |
| Settings | `SettingsPanel` | none (localStorage) | n/a |
| Behavior | `MapBehaviorForm` | `updateMapSettingsAction` | `settings_manage` |
| Auto-tagging | `MapTaggingForm` | `updateMapSettingsAction` | `settings_manage` |
| Webhooks | `MapWebhooksPanel`, `WebhookForm`, `WebhookRowActions` | `GET /api/map/[mapId]/webhooks` plus 5 actions in `webhooks.ts` | `webhooks_manage` |
| Share links | `MapSharePanel` | `listShares`, `createMapShare`, `revokeMapShare` | `share_manage` |
| Export | `ExportPanel` | `GET /api/map/[mapId]/export` | `map_export` |
| Import | `ImportPanel` | `POST /api/map/[mapId]/import` | `map_import` |
| Roles & Permissions | `MapRolesForm` | `getMapDelegationState`, `setMapDelegation` | `canManageMap` |

### What is correct

Server-side gating is sound throughout. Every mutation re-checks authority independently of what the UI rendered. Specifically:

- Delegation is itself manager-only, so a title granted `settings_manage` cannot hand capabilities to other titles (`mapRoles.ts:54`, `:118`).
- `setMapDelegation` re-validates that the `roleId` is a `corp_title` of this map's owning corp, so a forged id from another corp is rejected (`mapRoles.ts:129-138`).
- `revokeMapShare` returns the same "not found" for an unknown id and for a forbidden one, so sequential share ids cannot be enumerated (`mapShares.ts:138-144`).
- Share redaction profiles are immutable at mint, so a URL already in circulation cannot widen its disclosure.
- Kicked and banned characters are stopped at `requireSession` (`session.ts:36-45`), which covers the fact that `hasMapCapability` does not itself check `ap_character.status`.

### Finding 1: General tab is shown and editable to viewers who cannot save it (Medium)

`MapSettingsDialog.tsx:87` renders `GeneralPanel` unconditionally, but `updateMapSettingsAction` requires `settings_manage` (`src/app/(app)/actions/map.ts:185`). A plain corp member opens Settings, sees an editable Name and Icon with a live Save button, types a new name, and receives a `Forbidden.` toast. Every other management surface in the dialog is capability-revealed. This one is not.

**Fix:** wrap the panel in `can('settings_manage')`, or render the fields read-only without it.

### Finding 2: The `settings` prop never refreshes, so saved values appear to revert (Medium)

`MapCanvas` passes `settings` straight from the server page (`MapCanvas.tsx:274`, `:2272`). It is a prop, never state.

Three things combine:

1. `updateMapSettingsAction` calls `revalidatePath('/maps')` (`map.ts:259`), not `/map/[id]`, so the current route is not re-rendered.
2. `applyEvent`'s `map.update` case folds only `name`, and only into `viewData.map`, not into `settings` (`applyEvent.ts:113-116`). The behavior fields ride the payload but nothing consumes them, and the tagging fields are not echoed at all by design.
3. Base UI's `Dialog.Portal` defaults to `keepMounted={false}`, so closing the dialog unmounts every panel. Reopening re-seeds `MapBehaviorForm`, `MapTaggingForm` and `GeneralPanel` from the stale prop.

**Reproduction:** toggle "Delete EOL connections" off, Save (success toast fires, the DB row is correct), close the dialog, reopen it. The checkbox is back on. The same applies to the tagging scheme and to the name field.

**Fix:** `router.refresh()` on success, or `revalidatePath` on the map route. Either resolves all three panels.

### Finding 3: Delegated title-holders outlive managers on a soft-deleted map (Low)

`webhooks.ts:42` and `mapShares.ts:45` gate on `canUseMapFeature` directly instead of `requireMapCapability`. `canUseMapFeature`'s `hasMapCapability` branch queries only `ap_map_role_access` joined to `ap_character_role`, so it never loads the map row and never sees `deleted_at`. `canManageMap` does load it (`rights.ts:79-90`) and returns false.

The result is inverted: during the 30-day deletion grace, a delegated title-holder can still mint share links and edit webhooks on a map its Director can no longer touch. Not reachable through the UI, since the map page is gone, only by direct action invocation.

**Fix:** route both through `requireMapCapability`.

Note that export and import are **not** affected, because they use `requireMapCapability`, whose `canViewMap` step filters `deletedAt`.

### Finding 4: Delete button on `/maps` ignores `map_delete` entirely (Low)

Not in the dialog, but it is the other half of the Roles matrix, which advertises "Delete" as delegatable. `src/app/(app)/maps/page.tsx:51` renders `DeleteMapButton` on every viewable map card with no capability check. Every corp member sees a trash icon on every corp map. The action correctly refuses. Same defect class as Finding 1.

`map_delete` is the one capability of the seven that gates its action correctly but reveals no UI, so granting it changes nothing visible and withholding it still shows the button.

### Finding 5: Roles & Permissions tab appears on maps where it can never work (Low)

Gated on `canManage` alone (`MapSettingsDialog.tsx:83`), so a private-map owner or an alliance manager gets a tab whose entire content is "Feature delegation is available on corporation maps only."

**Fix:** add `settings.type === 'corp'` to the tab condition.

### Accepted, not a defect

`capabilities` and `canManage` are an SSR snapshot. Revoking a title's capability does not retract tabs from a session that is already open. The user keeps the tab until reload, and every action attempted from it is refused server-side. This is correct behavior for a broadcast-only WebSocket, but it is worth knowing if a stale-tab report ever arrives.

---

## Part 2: Per-setting functional test

Four of roughly 28 controls are inert. Everything else is wired end to end.

### General

| Control | Verdict | Evidence |
|---|---|---|
| Name | works | written `map.ts:205`, folded live `applyEvent.ts:113`, rendered throughout |
| Icon | **dead** | see Finding 8 |
| Scope (read-only) | **decorative** | see Finding 9 |
| Visibility / type (read-only) | works | drives ownership and every permission branch in `rights.ts` |

### Settings (per-device)

| Control | Verdict | Evidence |
|---|---|---|
| Low-contrast theme | works | `globals.css:145` defines `.dark.low-contrast`, plus `:164` for the react-flow canvas; `LowContrastController` applies the class pre-paint |
| Group wormhole types by category | works | consumed by `WormholeTypeSelect.tsx`, covered by `tests/unit/wormhole-type-select.test.tsx` |

### Behavior

| Control | Verdict | Evidence |
|---|---|---|
| Delete expired connections | works | `expiredConnections.ts:41`, `eq(apMap.deleteExpiredConnections, true)` in the job's WHERE |
| Delete EOL connections | works | `eolExpiry.ts:52`, same pattern |
| Track abyssal jumps | **dead** | see Finding 6 |
| Log activity | **dead** | see Finding 7 |

### Auto-tagging

All three fields are wired. `tagScheme` and `exemptHomeStaticFromTag` are read by `tagging/service.ts:26-28`; `homeMapSystemId` drives `abc.ts`, `scheme0121.ts` and `exemption.ts`. The tab's promise that Home "cannot be removed from the map while designated" is enforced for real at `mutations/systems.ts:158`, with an error message that points back at this tab.

### Webhooks

Fully wired. `channel` filters dispatch (`dispatcher.ts:112`, `:161`), `event` selects the formatter and gates rally-only firing (`:109-117`), `username` is applied as the Discord override (`:124`, `:174`), `url` is the target. Test-fire reuses the real `deliver()` path, so the health badge reflects a genuine attempt.

### Share links

Fully wired. Every flag is honored in the redacted snapshot: `showConnectionSigIds` (`loadPublicMap.ts:228`, `:280`), `showSignatures` (`:234`), `presenceMode` (`:238`, `:388-395`), `showBubbles` (`:275-276`). Expiry is enforced at token resolution (`share.ts:54-55`), not merely displayed.

### Finding 6: `Track abyssal jumps` is inert, and contradicted by the code (Medium)

Every reference to `trackAbyssalJumps` is one of: the schema definition, the write path, a read for display, the export schema, or the realtime payload zod. There is no consumer.

It is worse than unread. `locationPoll.ts:228` folds only `jumpClass === 'wormhole'`, and `locationToConnection.ts:29-32` states as deliberate policy that abyssal transitions are "never a real chain edge. We never map abyssal systems or their links." The toggle's label reads "Record abyssal traversals as connections". The code is hard-wired to refuse, in both toggle positions, and it defaults to on.

### Finding 7: `Log activity` is inert (Medium)

Same pattern, no consumer. `commitMapEvent` (`mutations/core.ts:77`) never loads the map row and never consults the flag; it writes `ap_map_event` unconditionally. The only DB trigger, `fn_map_event_notify` (`0004_map_schema.sql:115`), just calls `pg_notify`. Turning the toggle off logs exactly as much as leaving it on.

This is the more serious of the two, because a user who turns "Log activity" off in order to stop recording will still be fully audited.

Both flags were created in migration 0004 with `DEFAULT true` and have never had a consumer.

### Finding 8: Map `icon` persists but is never rendered (Low)

Written at `map.ts:206`, selected in `loadMap.ts:498/611/635`, serialized in `transfer.ts:149`, and never rendered. `/maps/page.tsx:38-54` draws name, type and scope only. No `.tsx` in the repo reads a map icon. The placeholder suggests `fa-home`; the value persists and nothing displays it.

### Finding 9: Map `scope` is presented as a constraint but is never enforced (Low)

`map_scope` is documented as "what kinds of systems a map is allowed to hold" (`enums.ts:19`, values `wh`, `k_space`, `none`, `all`). Every read of `apMap.scope` in the repo is a display SELECT (`loadMap.ts:294/499/609/633`, `transfer.ts:147`). `mutations/systems.ts` never consults it; the only `scope` there is the unrelated `apMapConnection.scope`.

A `k_space` map accepts wormhole systems without complaint. The General tab and the dialog subtitle both present scope as a fixed, meaningful property that "cannot be changed".

### Finding 10: Documentation drift (Cosmetic)

Several docblocks predate the R4 capability rework and still name the old gate:

- `MapSettingsDialog.tsx:30` and `MapSettingsDialog.md:23` say General saves under `map_update`. It is `settings_manage`. This one matters: `map_update` is view-gated, so the doc reads as "any viewer can rename the map", which is the opposite of what the code does.
- `MapBehaviorForm.tsx:36`, `MapTaggingForm.tsx:31`, `MapWebhooksPanel.tsx:45` say "gated by `canManageMap`". They are `settings_manage` and `webhooks_manage`.
- `MapAuditDialog.tsx:14` says the button renders for "`canManageMap` holders". It is `capabilities.includes('audit_view')`.
- `rights.ts:169` calls title delegation "the future R4 overlay" directly above the shipped implementation.
- `transfer.ts:140-141` claims `buildMapExport` exports `intel_notes` "which `loadMapForView` omits". `loadMapForView` selects them (`loadMap.ts:310`, `:421`).

Note that all four inert values also ride the export file (`transfer.ts:113/147/152/153`), so they round-trip faithfully as dead values.

---

## Part 3: Export and import gating

Checked in depth against the specific invariant: **until a title has been granted the capability, export and import must be reachable only by a manager** (admin, private-map owner, owning-corp Director, or owning-alliance executor-corp Director).

**The invariant holds.** Verified at six independent layers.

### 1. The gate itself

Both routes call `requireMapCapability` (`export/route.ts:25`, `import/route.ts:27`), which resolves in order: session, else 401; `canViewMap`, else 404 with no existence leak; `canUseMapFeature`, else 403. That last is `canManageMap(...) || hasMapCapability(...)` (`rights.ts:421-422`).

`hasMapCapability` filters on the exact capability, `eq(apMapRoleAccess.capability, capability)` at `rights.ts:403`. It is not "any grant row passes". With zero grants the EXISTS returns nothing, leaving `canManageMap` as the only way through.

### 2. Nothing else can create a grant row

The only production writer of `ap_map_role_access` is `setMapDelegation` (`mapRoles.ts:148`, `:151`). It is `canManageMap`-gated (`:118`), corp-map-only (`:125`), and re-resolves the `roleId` against `apRole.source='corp_title' AND corporationId = map.ownerCorporationId` (`:129-138`). Grant and revoke each land one `access.granted` or `access.revoked` audit event naming the title and the capability.

### 3. Nothing else can create a role membership

`ap_character_role` has exactly one writer in the repo: `syncCharacterAuthz.ts:262` (insert), `:280` and `:295` (delete), driven by ESI corp titles. No user-facing action assigns a role, so a member cannot self-attach to a granted title. Reconciliation runs both directions: losing a title in EVE deletes the membership (`:274-309`), restricted to `source='corp_title'` so unrelated grants survive.

### 4. No capability is pre-seeded

No migration inserts into `ap_map_role_access`. The migration that introduced the axis, `0056_map_role_capability.sql:23`, backfills pre-existing rows with `DEFAULT 'view'` then drops the default (`:26`) so future inserts must name a capability explicitly. Legacy view-overlay rows therefore did not silently become export or import grants.

### 5. No second path to the same code

`buildMapExport` and `importMapData` have exactly one production caller each, the two gated routes. Everything else is `tests/integration/map-import-export.test.ts`. There is no admin variant, no Server Action, and the public surface (`/api/public/[token]/snapshot`) serves only redacted `PublicMapViewData` with no export path.

Import cannot be turned into an escalation either. `mapExportSchema` (`transfer.ts:107-122`) carries no map id, `importMapData` writes only to `args.mapId` (the guarded one), and it never applies `data.map` metadata to the target. So `map_import` cannot cross maps or confer `settings_manage`.

### 6. The UI reveal matches, and is only a reveal

Tabs render behind `can('map_export')` and `can('map_import')` (`MapSettingsDialog.tsx:81-82`, `:127-136`), fed by `resolveMapCapabilities`, which returns an empty set for a non-manager with no grants. Both routes re-check regardless.

### Existing test coverage

`tests/integration/permissions.test.ts:344-386` lists `map_import` and `map_export` in its `FEATURES` array and asserts: a holder with only `audit_view` gets 403 on both (`:353`); a manager passes all six without any grant row (`:369`); a plain corp member who can view the map is 403 on all six (`:376`); an outsider gets 404; no session gets 401. That is the invariant, stated as a test.

### Three consequences worth knowing

**Granting export also grants map visibility.** `canViewMap`'s role overlay (`rights.ts:111-127`) matches on `role_id` with no capability filter, so any grant row implies view. Delegating `map_export` to a title that could not otherwise see the map silently widens who can see it. This is deliberate and documented in `0056_map_role_capability.sql:8-13`, but the Roles matrix does not say so.

**On private and alliance maps, export and import are manager-only permanently.** Delegation is corp-map-only in v1 (`mapRoles.ts:63-65`, `:125`), so there is no way to assign a title on those map types.

**Export is a friction control, not a confidentiality boundary.** Every field in the file is already served to any plain viewer: systems, connections, signatures and intel notes via `loadMapForView` (`loadMap.ts:310`, `:421`), and the map metadata plus all four behavior flags via `loadMapSettings`, which `map/page.tsx:71` calls for every viewer unconditionally. Gating `map_export` stops one-click bulk extraction. It does not withhold anything a member could not already read.

---

## Recommended actions

In rough priority order.

1. **Resolve the two inert Behavior toggles** (Findings 6, 7). Either remove them from the tab or implement them. `Log activity` is the urgent one: it is a privacy-shaped promise the system does not keep.
2. **Refresh the map route after a settings save** (Finding 2). One `router.refresh()` fixes the apparent revert across all three panels.
3. **Capability-gate the General tab** (Finding 1) and **the Delete button on `/maps`** (Finding 4). Both currently offer actions that always fail.
4. **Route the webhook and share actions through `requireMapCapability`** (Finding 3).
5. **Decide what `scope` and `icon` are for** (Findings 8, 9). Enforce scope in the system-add path or stop presenting it as a constraint; render the icon on the map cards or drop the field.
6. **Hide the Roles tab on non-corp maps** (Finding 5).
7. **Correct the stale docblocks and companions** (Finding 10).

### Suggested test additions

- `title-delegation.test.ts` exercises the grant and revoke round-trip only with `audit_view`. The end-to-end "grant `map_export` to a title, holder gains exactly that" path is covered at the `requireMapCapability` layer but never through `setMapDelegation`. Cheap to add.
- Nothing currently asserts that a non-manager cannot save the General tab, which is why Finding 1 went unnoticed.

---

## Not verified

The Part 3 conclusions are from static trace only. The intent was to execute `tests/integration/permissions.test.ts` as confirmation, but `aperture-db-1` was stopped and host port 5432 was held by an unrelated project's container (`formatka-db-real`), so `DATABASE_URL` resolved to the wrong database and the run failed at global setup with `28P01 password authentication failed`.

To complete it, free port 5432, start `aperture-db-1`, then:

```
RUN_DB_TESTS=1 npx vitest run tests/integration/permissions.test.ts tests/integration/title-delegation.test.ts
```

Run those two in isolation. The full suite is flaky under parallelism.
