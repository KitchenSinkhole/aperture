## PublicSystemNode

**Purpose:** xyflow custom node rendering one system tile on a public share — the app's `SystemNode` visual language with the whole interaction layer absent.
**File:** `src/components/public/PublicSystemNode.tsx`

### Props
Receives xyflow `NodeProps` with `data: PublicSystemNodeData`.

`PublicSystemNodeData` extends `PublicMapSystemNode` with:

| Field | Type | Description |
|---|---|---|
| presence | PublicNodePresence \| null | Per-system presence at the fidelity the token's `presenceMode` allows; null when it publishes none. |
| highlighted | boolean | Set while the matching entrances-board row is hovered. |

`PublicNodePresence` is a discriminated union: `{ mode: 'anonymous'; count; byClass }` or `{ mode: 'full'; pilots }`.

### Renders
A `bg-map-node` card with a thick left stripe in the security-class colour and a 1px resting ring in the system-status colour, laid out as two columns. The map's Home carries a gold accent ring outside the status ring and a gold home icon beside its name, the same pairing the app's `SystemNode` uses. Left: the security/class label above the tag, both `font-mono` in the class colour. Right: the system name (via `systemDisplayName`, so the five Drifter systems read by their community names) with the trade-hub pill and shattered / Drifter markers trailing it, above a footer line carrying either the ordered static target-class labels plus the anomaly-effect swatch (wormhole systems) or the region name (k-space).

Because `PublicMapSystemNode` has no `alias`, `locked`, `rallyAt` or lock-holder field, this tile structurally cannot render an operator-typed name, a lock icon, a rally underglow, or attribution.

### Behaviour & Interactions
- No connect handles, no inline editing, no selection styling, no signature-freshness or intel indicators, no underglow.
- `highlighted` stacks a wider halo in the class colour outside the resting status ring and the Home accent, so a board row and its tile read as the same thing and all three rings can show at once.
- Statics are ordered by `staticCompare` and each carries a tooltip naming its target class. Unlike the app's node there is no wormhole reference card — that data comes from a session-gated endpoint.
- The anomaly-effect swatch opens a hover panel listing the effect's bonuses resolved to this system's class; the class number is parsed from the security label.
- Presence badge floats off the top-left corner and renders only when the count is non-zero. Its hover panel shows hull-class buckets under `anonymous` (with a count of hulls the buckets don't identify) and a `SystemPresenceTable` under `full`.
- Wormhole detection: has statics, or the name matches `J######`.

### Depends On
- `@xyflow/react` (`NodeProps`), `@base-ui/react/preview-card`, `@base-ui/react/tooltip`, `lucide-react` (`Atom`, `CircleDashed`)
- `@/components/map/styling` (`systemClassColor`, `systemStatusColor`, `systemEffectColor`, `homeAccentColor`)
- `@/components/map/SystemPresenceTable`, `@/components/icons/ShipClassIcon`
- `@/lib/map/staticOrder` (`staticCompare`), `@/lib/eve/drifterSystems`, `@/lib/eve/shatteredSystems`, `@/lib/eve/shipClass` (`SHIP_CLASS_LABELS`), `@/lib/eve/systemEffects`
- Types `PublicMapSystemNode`, `PublicPresencePilot`, `ShipClass` from `@/types`
