## signature-eol-cell.test.tsx

**Purpose:** Server-render coverage that the signature table's EOL cell marks a linked connection's age-based (`eolSource = 'auto'`) EOL as an estimate.
**File:** `tests/unit/signature-eol-cell.test.tsx`

No DB required (static render of `SignatureModule`). Cases:
- A wormhole sig linked to an `('eol', 'auto')` connection renders the estimate marker.
- The same sig linked to an `('eol', 'observed')` connection does not.
