## IntelScopeChip

**Purpose:** A pill naming who may see one row of scoped intel (private / corp / alliance).
**File:** `src/components/sidebar/IntelScopeChip.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| scope | IntelScope | yes | The row's tenancy tier |
| className | string | no | Extra classes for placement |

### Renders
An inline bordered pill: a per-tier lucide icon (lock / users / flag) plus the tier name in small uppercase text, colour-coded per tier. A `title` carries the full audience sentence.

### Behaviour & Interactions
- **Names the tier, never the entity.** The read filter admits a non-admin only to rows scoped to their own character, corp or alliance, so the entity id adds nothing the tier does not already say. An admin sees rows from organisations they are not in, which is why the audience copy is phrased about the row ("the corporation it belongs to") rather than about the viewer.
- Word-and-icon styling keeps it distinct from the citadel's in-game owner corp, which structure rows render as a CCP logo plus a name.

### Emits / Calls
- `intelScopeAudience(scope)` — exported alongside the component; returns the audience sentence for callers that want the prose without the pill (the structure dialog's pre-submit line).

### Depends On
- `IntelScope` (`src/types`) — the `intel_scope` enum's values.
