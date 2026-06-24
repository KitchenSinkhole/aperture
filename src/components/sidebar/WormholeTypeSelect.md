## WormholeTypeSelect

**Purpose:** Class-aware wormhole-type dropdown for the signature inspector — short by default, with a "show all" escape hatch.
**File:** `src/components/sidebar/WormholeTypeSelect.tsx`

### Props
| Prop | Type | Required | Description |
|---|---|---|---|
| systemSecurity | string \| null | yes | Host system's class label (`MapSystemNode.security`); drives `matchesClass`. |
| staticTypeIds | number[] | yes | Host system's static `universe_wormhole.type_id` set (`MapSystemNode.staticTypeIds`); drives `isStatic`. |
| value | number \| null | yes | Selected `universe_wormhole.type_id`, or null when unset. |
| onValueChange | (next: number \| null) => void | yes | Fires when the user picks a different option. |
| disabled | boolean | no | Disables the trigger. |
| triggerClassName | string | no | Merged onto the `SelectTrigger` (via `cn`) — used by `SignatureModule` to flatten the pill styling in-table. |

### Renders
A `Select` populated with WH codes (e.g. "A239", "K162"). Each option uses a flex `justify-between` layout: WH name on the left, destination class on the right, rendered bold and color-coded via `systemClassColor` — the same palette the map uses for system-node statics. The closed trigger mirrors this layout (name left, color-coded class pushed to the right edge) via a `SelectValue` render function given `flex-1` so it stretches the full trigger width. The first item is a sentinel "Select type…" that maps to `null`.

Options are split into four groups, each keeping the catalog's alphabetical order:
- **Statics** (`isStatic`) — pinned to the top under a "Statics" label, then a divider.
- **K162** — always rendered immediately after statics (before other class-matched holes) since it is the canonical "inbound" exit hole.
- **Class-matched** (`matchesClass && !isStatic && name !== 'K162'`) — holes that plausibly spawn in this system's class; shown by default.
- **Others** (`!matchesClass`) — the rest of the catalog, hidden behind a `Show all types (+N)` / `Show fewer` toggle button at the foot of the list (a plain `<button>`, not a `SelectItem`, so clicking it expands the group without selecting or dismissing the popup).

Option rows and the popup are vertically compacted (`py-1` items, `p-0.5` content) to fit the dense Signatures module.

### Behaviour & Interactions
- On mount, calls `fetchWormholeCatalog()` — the static catalog is fetched **once per session** and shared by every dropdown (no per-system fetch). The component then derives this system's options with `annotateWormholeTypes(catalog, { security, staticTypeIds })` in a `useMemo`.
- Partitions options into statics / K162 / class-matched / others, preserving the catalog's alphabetical order within each group.
- `showAll` (local) gates the "others" group; collapsed by default. The parent re-mounts the module body on system change (`key={system.id}`), so this resets naturally.
- Disables itself during the initial load.
- Treats the sentinel value `__none__` as null in both directions.

### Module-level helpers
- `OptionDivider` — thin `<div>` that renders the horizontal separator between groups; declared at module scope (not inside the component) to satisfy the `react-hooks/static-components` rule.

### Depends On
- `Select*` from `@/components/ui/select`
- `fetchWormholeCatalog` from `@/lib/map/client`
- `annotateWormholeTypes`, `WormholeCatalogEntry` from `@/lib/map/wormholeCatalog`
- `systemClassColor` from `@/components/map/styling` — destination-class color coding
- `WormholeTypeOption` from `@/types`
