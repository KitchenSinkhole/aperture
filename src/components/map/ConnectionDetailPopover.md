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
A base-ui `Tooltip` whose trigger is the styled badge-cluster box (wrapping `children`) and whose popup is a header line plus a compact key/value list:
- **Header** (bordered): the wormhole code (`wormholeCode` or `unknown`), the size class (`connection.jumpMassClass`), and the leads-to class (`targetClass`) coloured by `systemClassColor` — e.g. `B274  L  H` with `H` in the shared class colour.
- Body (only when the type is known): Total mass / Max jump / Max lifetime.
- **Mass logged**: the mass-log cumulative plus its share of the WH type's total stable mass, e.g. `350 kt (32%)`; the percentage is omitted when the total mass is unknown.
- **EOL row** (when `eolStage !== 'none'`): the stage label (`EOL 4h` for `eol`, `EOL 1h` for `critical`) and an `H:MM` countdown, e.g. `EOL 4h   1:24`; the colon carries the `ap-blink` utility (1s CSS on/off) to read as a live clock.

### Behaviour & Interactions
- Opens on hover (base-ui default delay; the popup is itself hoverable). The mass-log cumulative (`fetchConnectionMassLog`) is refetched on every open, so re-hovering an active hole reflects newly logged jumps. Static wormhole data (`fetchWormholeJumpInfo`, session-cached) is fetched once per known wormhole type and held in local state; a WH signature attached after the first hover flips `wormholeTypeId` null → known and the next open fetches the reference. Mass logged reads `…` until the fetch resolves, then the cumulative (0 when no jumps logged).
- When `wormholeTypeId` is null the reference fetch is skipped and the static rows are omitted — the header code reads `unknown` (no leads-to), leaving Size / Mass logged / countdown.
- The EOL countdown ticks every 30s while the popup is open (the row unmounts on close), derived from `connectionTimeLeftMs` (nominal 4h/1h) rendered as `H:MM` floored to zero. The colon blinks continuously via the `ap-blink` CSS keyframe (independent of the 30s data tick).

### Depends On
- `@base-ui/react/tooltip` (`Tooltip`).
- `@/lib/reference/client` (`fetchWormholeJumpInfo`) + `@/lib/map/client` (`fetchConnectionMassLog`).
- `@/lib/map/connectionState` (`connectionTimeLeftMs`) for the countdown.
- `@/lib/eve/wormholeFormat` (`formatWormholeMass`, `formatWormholeLifetime`).
- `./styling` (`systemClassColor`) for the leads-to class colour.
