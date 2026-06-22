## SignatureModule

**Purpose:** Standalone full-width signatures panel rendered below the map. Renders a filterable, sortable nine-column table (Sig / Group / Type / Description / Leads to / TTL / Created / Updated / delete) for the selected system; placeholder when nothing is selected.
**File:** `src/components/sidebar/SignatureModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | `ap_map.id` (for the WH-types endpoint and paste dialog). |
| system | MapSystemNode \| null | yes | The selected system; when `null` the panel renders a "select a system" placeholder. |
| signatures | MapSignature[] | yes | All signatures on the map; the module filters by `mapSystemId === system.id`. |
| connections | MapConnectionEdge[] | yes | All connections on the map (forwarded to `ConnectionSelect`). |
| systems | MapSystemNode[] | yes | All systems on the map (forwarded to `ConnectionSelect`). |
| onCreate | (body: CreateSignatureBody) => void | yes | Called when the user submits the add form. The parent issues the POST. |
| onPatch | (signatureId: string, patch: UpdateSignatureBody) => void | yes | Called for inline edits (group/type/description/connection). |
| onDelete | (signatureId: string) => void | yes | Called from the row trash button. |
| onConnectionPatch | (connectionId: string, patch: UpdateConnectionBody) => void | yes | Used to auto-set a linked connection's jump-mass size from the WH type (see below). Wired to `MapCanvas`'s `onConnectionPatch` (optimistic). |
| flashSigId | string \| null | no | When set, the matching signature row flashes with `ap-sig-flash` for 3 s. Cleared by MapCanvas after the timeout. Known limitation: if the target sig is hidden by the in-panel group/scan filter, the flash silently no-ops. |

The **Lazy delete** and **Paste from scanner** actions are no longer rendered by this card — they live in `SignatureModuleHeaderActions` (also exported from this file), which `MapCanvas` renders into the `MapPanel` header via `headerRight`. See that component's props below.

### Renders
A frameless `Card` (no card header) with:
- Body only: when no system is selected, a placeholder message. When a system is selected: a **filter bar** (`SignatureFilterBar`) above the table, the nine-column TanStack Table, and a draft-input row below. TTL is a forward countdown (`formatRelativeFromMs`); Created and Updated are backward "time ago" strings (`formatAgoFromMs`). The panel name ("Signatures"), drag handle and hide button come from the surrounding `MapPanel` chrome.
- The **Sig**, **Group**, **Created**, and **Updated** column headers are sortable (click to sort ascending, click again to reverse, arrow indicator shows active sort). Default sort is Sig ascending. Other columns (Type, Description, Leads to, TTL, delete) are non-interactive headers.
- The filter bar has group toggle chips (Combat / Relic / Data / Gas / Wormhole / Ore / Ghost / Unknown) and a scan-state button cycling **All → Scanned only → Unscanned only**. Both filters compose; `assignedConnectionIds` is derived from the unfiltered row list so hidden sigs still hold their connection bindings.
- **Row density:** the table is tuned for high data density. The `<table>` carries `[&_[data-slot=input]]:h-6 [&_[data-slot=select-trigger]]:h-6` so in-row selects and inputs shrink from the default `h-8` to `h-6`; the body cell wrappers use `py-px` (1px, down from `py-0.5`); the header padding in `colHeaderClass` is `py-0.5` (down from `py-1`); and the row delete button is `size="icon-xs"` (`size-6`, was `size="icon"` / `size-8`) with a `size-3.5` glyph so it no longer gates row height. All scoped to the table, so the draft "Add" row below (outside the `<table>`) keeps standard `h-8` controls for comfortable data entry.

### Behaviour & Interactions
- **Stable cell identities (don't close open selects on realtime updates):** the nine table cells are rendered by **module-level** components (`SigIdCell`, `GroupCell`, `TypeColumnCell`, `DescriptionCell`, `LeadsToCell`, `TtlCell`, `CreatedCell`, `UpdatedCell`, `ActionsCell`) referenced from a single module-level `signatureColumns` array — **not** an in-`useMemo` columns array. This is load-bearing: TanStack's `flexRender` renders each `columnDef.cell` as a React component *type*, so when the cell was a fresh closure per render (the old approach) React saw a new type at every cell on each data change and unmounted + remounted the whole cell subtree. That remount slammed an open in-row `Select` (e.g. WH type, Group, Leads-to) shut the instant another viewer edited a signature in the same system — the system-scoped edit churns `rows` → `assignedConnectionIds` → the columns memo. The volatile data the cells need (`mapId`, `system`, `connections`, `systems`, `onPatch`, `onDelete`, `syncConnectionSize`, `metaByTypeId`, `assignedConnectionIds`) is passed in through TanStack's `table.options.meta` (typed `SignatureTableMeta`) and read via `table.options.meta as SignatureTableMeta` inside each cell, so the cell function identities never change and a realtime update re-renders cells **in place** rather than remounting them. The Base UI `Select` keeps its open state internally (uncontrolled), so in-place re-render leaves an open dropdown open.
- The body re-mounts on system change (`key={system.id}`) so draft state for the add form resets cleanly when the selection changes. The **filter state is exempt** from this reset: group/scan filters are seeded from `localStorage` on mount and persisted on change (see "Filter persistence" below), so they survive both system switches and full sessions.
- **Group cascade:** Changing a row's Group to a *different* value nulls `typeId` and `name`; when the new group is no longer `wormhole` (or wasn't but now is), `mapConnectionId` is also nulled. Re-selecting the same group is a no-op — no PATCH is issued and no fields are cleared. The cascade is sent as one PATCH containing the combined keys (see `buildGroupChangePatch`).
- **Type cell** cascades on Group:
  - `wormhole` → `WormholeTypeSelect`. Picks a `universe_wormhole` row; writes `typeId`.
  - cosmic groups → `SiteTypeCombobox` bound to `sig.name`: class+group-filtered site-name suggestions (from `signatureSites.ts`, keyed off `system.security`) with a free-text fallback; patches on blur.
  - `null` (unknown) → italic placeholder text.
- **Leads-to cell** is `ConnectionSelect`, enabled only for `groupKey === 'wormhole'`. Its options are filtered to the selected WH type's destination class via the `targetClass` prop: `useWormholeTypeMeta(mapId, system.systemId)` builds a `typeId → { targetClass, jumpMassClass }` map (reusing the cached `fetchWormholeTypes` data), and the row/draft pass the entry for `sig.typeId` / `draftTypeId`. A type with no/unknown target (e.g. K162) passes `null` → unfiltered. Options are also filtered by `excludeIds={assignedConnectionIds}` (the connection ids already bound to a sig in this system) so a connection already claimed by another sig isn't suggested — the binding is 1:1. `assignedConnectionIds` is `rows.map(s => s.mapConnectionId)` (non-null); each `ConnectionSelect` exempts its own `value`, so a row keeps showing its own binding.
- **Auto-set connection size:** once a WH sig has both a type and a linked connection, `syncConnectionSize(typeId, connectionId)` pushes the type's inferred `jumpMassClass` (from the same `useWormholeTypeMeta` map, server-derived from `wormholeMaxJumpMass`, e.g. O477 → `L`) onto that connection via `onConnectionPatch`. Fired whichever side is set last: from the Type cell's change (with the row's existing `mapConnectionId`), the Leads-to cell's change (with the row's `typeId`), and on draft submit (with the draft's type + connection). A type whose band can't be inferred (K162) leaves the connection size untouched.
- **Description cell** uses `EditableTextCell` to patch `sig.description` on blur.
- **`EditableTextCell`** is a small internal helper: a controlled `Input` with a local draft, committed on blur. It re-syncs from `value` only when the input isn't focused, so optimistic-apply and realtime updates don't clobber mid-edit typing. Controlled-mode also avoids Base UI's "uncontrolled `FieldControl` default value changed after init" warning that fires when the parent re-renders with a new `defaultValue` after a blur-triggered patch.
- **Missing-cell highlight:** a sig is "fully scanned" when its Sig, Group, and Type are filled in — plus "Leads to" for wormholes. Each still-empty *required* cell recolors its control's border to `destructive` (via the `MISSING_CELL` descendant-variant class on the `<td>`, targeting `data-slot=select-trigger` / `data-slot=input`), so unresolved cells read red at a glance. Per-cell rules: Group highlights when `groupKey === null`; Type highlights when a group is set but the value is empty (`typeId` for wormholes, `name` for cosmic groups — note this *does* count a missing cosmic site name, unlike the map-node `isUnscanned` rollup); "Leads to" highlights only for wormholes with no `mapConnectionId`. The Sig cell is never highlighted (always present), and Type isn't flagged while the Group is still empty (fix the group first).
- **Flat in-table controls:** the editable cells (Group / Type / Description / Leads to) drop the default control "pill" at rest so each row reads like static data — no border, background, or shadow until the control is hovered, focused, or its dropdown is open. Two module constants carry the override classes: `FLAT_TRIGGER` (for the select-based cells) and `FLAT_INPUT` (for the text/combobox cells). They're passed down as `triggerClassName` / `inputClassName` (the Type cell forwards both through `TypeCell`) and merged onto the underlying `SelectTrigger` / `Input` via `cn`, so tailwind-merge drops the conflicting base utilities — including the `dark:` background. The draft "add" row below the table passes neither, so it keeps the normal pill styling. `MISSING_CELL`'s red border still wins on unscanned required cells (it's applied on the `<td>` with higher specificity), so the scan cue survives the flattening.
- Filters incoming `signatures` to the current system by `mapSystemId`.
- **Filter bar** (`SignatureFilterBar`): group chips are multi-select toggles (empty = show all groups); the scan-state button cycles All / Scanned only / Unscanned only. "Fully scanned" = group set AND type set (for wormholes `typeId`, for cosmic `name`) AND for wormholes `mapConnectionId` set. Filter state lives in `SignaturePanelBody` and is persisted to `localStorage` (shared across all systems and sessions — see "Filter persistence").
- **Filter persistence:** group and scan filters are saved under the single `localStorage` key `aperture:signatures:filter` (`{ groups: (SignatureGroupKey | null)[], scan: ScanFilter }`). `loadPersistedFilter()` reads + validates the blob (falling back to `{ groups: [], scan: 'all' }` on absence/parse error); the `Set<SignatureGroupKey | null>` is serialized as an array (`null` = the "Unknown" chip). A `useEffect` rewrites the key whenever either filter changes. The key is global — not per-map or per-system — so the preference is uniform everywhere.
- **Active-state styling:** group chips render via the local `FilterToggle` helper — active = soft violet tint (`border-violet-400/50 bg-violet-400/15 text-violet-300`), inactive = muted `outline` — so enabled filters stand out without the harshness of a solid fill. Violet is used rather than `primary` because the theme's `primary` is near-neutral and reads as gray at low opacity. The scan button tints the same way when active: emerald for "Scanned only", sky for "Unscanned only" (sky echoes the map's unscanned `Signal` pill on `SystemNode`); "All" is a plain outline. All active tints carry `dark:`-prefixed copies so they override the `outline` variant's `dark:bg-input/30`.
- The add form's `sigId` is auto-uppercased; required (Add disabled while empty). Group dropdown is required to enable the Type cell.
- `expiresAt` for new sigs defaults to `now + apertureConfig.SIGNATURE_DEFAULT_TTL_MS`.
- **Paste from scanner** and **Lazy delete** are rendered by `SignatureModuleHeaderActions` in the panel header (see below), not by this card.

## SignatureModuleHeaderActions

**Purpose:** The **Search** button, **Lazy delete** arm toggle, and **Paste from scanner** button for the Signatures panel, rendered into the `MapPanel` header (`headerRight`) beside the panel title rather than inside the card.
**Exported from:** `src/components/sidebar/SignatureModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | `ap_map.id` for the paste dialog. |
| system | MapSystemNode \| null | yes | The selected system; when `null` only the search button is rendered (it searches across all systems). |
| signatures | MapSignature[] | yes | All signatures on the map; filtered to the active system for the paste dialog's existing-sig set. |
| onBulkPaste | (payloads: MapEventPayload[]) => void | yes | Forwarded to `SignaturePasteDialog` as its `onResult`; caller registers each `eventId` in its dedupe set and applies each payload locally. `MapCanvas` passes its `onSignaturePasteResult` here (not the raw `onBulkPaste`), so a dialog paste also raises Stage 4 restore-connection offers. |
| lazyDelete | boolean | yes | Whether the one-shot CTRL+V "Lazy delete" arm is active (state owned by `MapCanvas`, shared with `SignaturePasteHotkey`). |
| onLazyDeleteChange | (next: boolean) => void | yes | Toggles the lazy-delete arm from the header button. |
| onOpenSearch | () => void | yes | Opens the `SignatureSearchDialog`. Wired to `setSigSearchOpen(true)` in `MapCanvas`. The search button is always rendered (searches across all systems); lazy-delete and paste remain gated on a selected system. |

### Behaviour & Interactions
- **Paste from scanner** (`SignaturePasteButton`) opens `SignaturePasteDialog` with the active system pre-bound.
- **Lazy delete** (`LazyDeleteToggle`): a one-shot arm button. Click to arm (renders `destructive` variant, label "Lazy delete armed"); while armed, the next direct CTRL+V scanner paste also removes sigs absent from the paste. The arm state lives in `MapCanvas` and is consumed (disarmed) by `SignaturePasteHotkey` once that paste commits — a deliberate arm-then-paste gesture so an accidental Ctrl+V can't wipe sigs. Only affects the direct-paste hotkey, not the paste dialog (which carries its own remove options).

### Depends On
- `WormholeTypeSelect`, `SignatureGroupSelect`, `ConnectionSelect`, `SiteTypeCombobox`
- `SignaturePasteDialog` (`@/components/dialogs/SignaturePasteDialog`)
- `Card`, `Button`, `Input` from `@/components/ui/*`
- `labelForSignatureGroupKey` from `@/lib/map/signatureGroups`
- `formatRelativeFromMs`, `formatAgoFromMs` from `@/lib/map/relativeTime`
- `fetchWormholeTypes` from `@/lib/map/client` (target-class + jump-mass-band map for the Leads-to filter and connection-size auto-set)
- `apertureConfig` (`SIGNATURE_DEFAULT_TTL_MS`) from `aperture.config`
- `@tanstack/react-table` — `useReactTable`, `createColumnHelper`, `getSortedRowModel`, `flexRender` for the sortable table
- `SIGNATURE_GROUP_CATALOG` from `@/lib/map/signatureGroups` (group chip iteration)
- Types: `MapConnectionEdge`, `MapEventPayload`, `MapSignature`, `MapSystemNode`, `SignatureGroupKey` from `@/types`; body types from `@/lib/map/client`
