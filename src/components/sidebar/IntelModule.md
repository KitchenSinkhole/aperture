## IntelModule

**Purpose:** Shows selected-system read-side intel from sovereignty/FW tables and third-party integrations.
**File:** `src/components/sidebar/IntelModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| system | MapSystemNode \| null | yes | Currently selected system, or null when nothing is selected |
| intel | SystemIntelSummary \| undefined | no | Read-side intel keyed by the selected system id |

### Renders
Compact sidebar card leading with the system name and its EVE system ID, followed by the rest of the system metadata, sovereignty, faction warfare, incursion, EVE-Scout hits, and external links. Recent kills live in the separate `SystemKillboardModule`, not here.

### Behaviour & Interactions
- Empty selected-system state prompts the user to select a system.
- Missing external data renders an empty state instead of blocking the map.
- External links open in a new tab.
- The **System** row is the first metadata row, holding the system name and the EVE system ID side by side on one line; the ID is monospace and de-emphasised. A long name truncates rather than pushing the ID out of the row.
- The system name, system ID, region, and constellation each carry a copy control that writes that value to the clipboard — the ID as a bare number, with no label or prefix. Success and failure both report through a toast. The controls are muted until hovered or focused, and are keyboard-reachable buttons.
- The system-meta block shows the W-space anomaly effect (when set) as a colour swatch (`systemEffectColor`) + friendly name (`systemEffectName`), not the raw `effect` key.
- **Security** shows the numeric `trueSec` (e.g. `0.4`) colour-coded by `trueSecColor` for k-space; for WH/Pochven/Abyssal (no `trueSec`) it shows the `security` label coloured by `systemClassColor`.
- **Sovereignty / FW** prefer the resolved entity name (alliance → corp → faction precedence for sov), falling back to `Alliance <id>` / `Faction <id>` only until the name cache warms.
- **Incursion** block renders only when the selected system is in an active incursion; shows faction, state, influence %, a `Staging` marker for the staging system, and `Boss spawned` when `has_boss`.

### Depends On
- `SystemIntelSummary` - server-computed view model from `src/lib/map/intel.ts`.
- `@/lib/eve/systemEffects` (`systemEffectName`, `SystemEffectKey`), `@/components/map/styling` (`systemEffectColor`, `systemClassColor`, `trueSecColor`).
- `lucide-react` - external-link and copy icons.
- `sonner` - toast reporting the outcome of a copy.
