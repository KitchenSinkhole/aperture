## SignatureIcon

**Purpose:** App-wide glyph for a Cosmic Signature (a scanner entry that must be scanned down).
**File:** `src/components/icons/SignatureIcon.tsx`

### Props
Accepts all `LucideProps` (forwarded), e.g. `className` for size and `color` to override. Defaults to the signature red `#E30001`.

### Renders
A Lucide `Plus` (＋ cross) with `aria-label="Signature"` and a nested `<title>Signature</title>` (native hover tooltip + accessible name). Swap the underlying Lucide icon here to change every signature glyph in the app at once.

### Used By
- `SignatureModule` (`ClassKindCell`) — the left-most class-kind column in the map signature panel.
