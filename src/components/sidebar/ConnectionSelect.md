## ConnectionSelect

**Purpose:** Dropdown of connections incident to the active system, used to bind a wormhole signature to a placed connection.
**File:** `src/components/sidebar/ConnectionSelect.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| system | MapSystemNode | yes | The active map system; filters connections to those incident to its `id`. |
| connections | MapConnectionEdge[] | yes | All connections on the map (filtered client-side). |
| systems | MapSystemNode[] | yes | All systems on the map (used to look up the other end's label). |
| value | string \| null | yes | The currently bound `ap_map_connection.id`, or `null`. |
| onValueChange | (next: string \| null) => void | yes | Fires when the user picks a different option (or clears). |
| disabled | boolean | no | Disables the trigger. Auto-disabled when no incident connections exist. |
| targetClass | string \| null | no | Selected WH type's destination class (e.g. `LS`). When set, filters options to far ends matching that class; the bound `value` is always kept. `null`/omitted = no filter (e.g. K162 leads anywhere). |
| excludeIds | string[] | no | Connection ids already claimed by another sig in this system. These are dropped from the list (1:1 sig↔connection binding); the current `value` is always exempt. |
| triggerClassName | string | no | Merged onto the `SelectTrigger` (via `cn`) — used by `SignatureModule` to flatten the pill styling in-table. |
| tagScheme | TagScheme | yes | The map's `ap_map.tag_scheme`; picks how the far end's class and tag combine into one label. |

### Renders
A shadcn `Select` listing each incident connection. Each option uses a flex `justify-between` layout: system name on the left, the far end's class+tag label (via `classTagLabel`, e.g. "C2G") on the right. That span is bold and color-coded via `systemClassColor` (keyed on the far end's `security`) — the same palette the map uses for system-node statics; the whole label including the tag carries the colour. First option is an "—" sentinel mapped to `null`. The closed trigger mirrors the option layout (label left, color-coded class+tag right) via a `SelectValue` render function. Option rows and the popup are vertically compacted (`py-1` items, `p-0.5` content) to fit the dense Signatures module.

### Behaviour & Interactions
- No API call — works entirely off the props passed by `MapCanvas`.
- Auto-disables when the active system has no connections.
- Treats `__none__` as `null` in both directions.
- When `targetClass` is set, options are filtered to connections whose far-end `security` equals it (e.g. a U210 → `LS` only lists lowsec exits). The currently-bound connection (`value`) is never filtered out, so changing the WH type after binding doesn't blank the trigger.
- When `excludeIds` is set, connections already bound to another signature in the system are dropped (the binding is 1:1). The current `value` is exempt, so a row never hides its own connection.
- The class+tag label is scheme-dependent: a `0121` map shows the tag alone (its tags are numeric, so `C3` + `2` would be indistinguishable from a class `C32`), every other scheme concatenates. The colour still keys on `security` either way.

### Depends On
- `Select*` from `@/components/ui/select`
- `systemClassColor` from `@/components/map/styling` — class+tag colour coding
- `classTagLabel` from `@/lib/tagging/display` — scheme-aware class+tag label
- `MapConnectionEdge`, `MapSystemNode` from `@/types`
