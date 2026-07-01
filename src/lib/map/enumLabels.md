## enumLabels.ts

**Purpose:** Client-safe mirrors of the `ap/*` pgEnum value lists, so `'use client'` modules can render dropdowns without pulling `drizzle-orm/pg-core` into the browser bundle.
**File:** `src/lib/map/enumLabels.ts`

---

### Exports

| Name | Shape | Notes |
|---|---|---|
| `SYSTEM_STATUSES` | `readonly ['unknown', 'friendly', 'occupied', 'hostile', 'empty', 'unscanned']` | Mirrors `systemStatus.enumValues`. |
| `SystemStatus` | union type | `(typeof SYSTEM_STATUSES)[number]`. |
| `CONNECTION_SCOPES` | `readonly ['wh', 'stargate', 'jumpbridge', 'abyssal']` | Mirrors `connectionScope.enumValues`. |
| `ConnectionScope` | union type | |
| `WH_MASSES` | `readonly ['fresh', 'reduced', 'critical']` | Mirrors `whMass.enumValues`. |
| `WhMass` | union type | |
| `WH_JUMP_MASSES` | `readonly ['s', 'm', 'l', 'xl']` | Mirrors `whJumpMass.enumValues`. |
| `WhJumpMass` | union type | |
| `EOL_STAGES` | `readonly ['none', 'eol', 'critical']` | Mirrors `eolStage.enumValues`. |
| `EolStage` | union type | |
| `NOTE_SEVERITIES` | `readonly ['neutral', 'green', 'yellow', 'red']` | Mirrors `mapNoteSeverity.enumValues`. |
| `NoteSeverity` | union type | |
| `NOTE_SEVERITY_LABELS` | `Record<NoteSeverity, string>` | Human labels for the note severity selector: `Neutral` / `Green` / `Yellow` / `Red`. |
| `EOL_STAGE_LABELS` | `Record<EolStage, string>` | Human labels for the inspector selector: `None` / `EOL (~4h)` / `Critical (~1h)`. |
| `WH_MASS_LABELS` | `Record<WhMass, string>` | Human labels for the mass selector: `Fresh (>50%)` / `Reduced (<50%)` / `Critical (<10%)`. |

### Drift guard
These lists must stay aligned with `src/db/schema/ap/enums.ts`. The wire-side Zod (`protocol.ts`) still validates everything that comes back from the server, so a stale label would surface as a runtime mismatch, not silently corrupt data.
