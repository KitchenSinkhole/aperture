## AnomalyIcon

**Purpose:** App-wide glyph for a Cosmic Anomaly (a scanner entry that is instantly warpable, no scanning needed).
**File:** `src/components/icons/AnomalyIcon.tsx`

### Props
Accepts all `LucideProps` (forwarded), e.g. `className` for size and `color` to override. Defaults to the anomaly green `#34CC37`.

### Renders
A Lucide `Circle` (◯) with `aria-label="Anomaly"` and a nested `<title>Anomaly</title>` (native hover tooltip + accessible name). Swap the underlying Lucide icon here to change every anomaly glyph in the app at once.

### Used By
- `SignatureModule` (`ClassKindCell`) — the left-most class-kind column in the map signature panel.
