## ConnectionDetailPopover

**Purpose:** Hover popover anchored to a connection's on-edge badge cluster, surfacing the source wormhole's static data, cumulative logged mass, and (for EOL holes) a live expiry countdown.
**File:** `src/components/map/ConnectionDetailPopover.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| connection | MapConnectionEdge | yes | The edge's connection data (drives size, EOL stage, countdown). |
| mapId | string | yes | Owning map id — scopes the mass-log fetch. |
| wormholeTypeId | number \| null | yes | Resolved source-wormhole `universe_wormhole.type_id`; null when unknown. |
| wormholeCode | string \| null | yes | Resolved source-wormhole code (e.g. "B274"); null when unknown. |
| children | ReactNode | yes | The badge spans rendered inside the trigger box. |

### Renders
A base-ui `Tooltip` whose trigger is the styled badge-cluster box (wrapping `children`) and whose popup is a compact key/value list: Type (`wormholeCode` or `unknown`), Size (`connection.jumpMassClass`), and — only when the type is known — Leads to / Total mass / Max jump / Max lifetime, followed by Mass logged (mass-log cumulative), and an `EOL expires in X` row when `eolStage !== 'none'`.

### Behaviour & Interactions
- Opens on hover (base-ui default delay; the popup is itself hoverable). Static wormhole data (`fetchWormholeJumpInfo`, session-cached) and the mass-log cumulative (`fetchConnectionMassLog`) are fetched lazily on first open; results persist in local state so re-opens are instant. Mass logged reads `…` until the fetch resolves, then the cumulative (0 when no jumps logged).
- When `wormholeTypeId` is null the reference fetch is skipped and the static rows are omitted — Type reads `unknown`, leaving Size / Mass logged / countdown.
- The EOL countdown ticks every 30s while the popup is open (the row unmounts on close), derived from `connectionTimeLeftMs` (nominal 4h/1h) + `formatRelativeFromMs`.

### Depends On
- `@base-ui/react/tooltip` (`Tooltip`).
- `@/lib/reference/client` (`fetchWormholeJumpInfo`) + `@/lib/map/client` (`fetchConnectionMassLog`).
- `@/lib/map/connectionState` (`connectionTimeLeftMs`) + `@/lib/map/relativeTime` (`formatRelativeFromMs`) for the countdown.
- `@/lib/eve/wormholeFormat` (`formatWormholeMass`, `formatWormholeLifetime`).
