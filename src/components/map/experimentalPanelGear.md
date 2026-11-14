## experimentalPanelGear.tsx

**Purpose:** Experimental per-grid gear popover in `MapPanelGroup` headers for map, routes, and pilots panels.
**File:** `src/components/map/experimentalPanelGear.tsx`

### Exports

| Export | Description |
|---|---|
| `ExperimentalPanelGearProvider` | Supplies `renderGearBody(panelId)` from `MapCanvas`. |
| `ExperimentalPanelGear` | Gear button + popover; renders nothing when unsupported or body is null. |
| `experimentalPanelSupportsGear(panelId)` | Whether the panel id has a gear slot (`canvas`, `route`, `pilots`). |

### Depends On
- `@/components/ui/popover`, `Button`, lucide `Settings2`.
