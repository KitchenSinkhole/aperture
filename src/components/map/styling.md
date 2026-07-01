## styling.ts

**Purpose:** Pure styling helpers translating system status, system class, and connection state into SVG-safe colours/strokes for the map canvas.
**File:** `src/components/map/styling.ts`

---

### systemClassColor(cls: string | null | undefined): string
Maps a `universe_system.security` or `universe_wormhole.target_class` label to a hex colour.
- `H` green, `L` orange, `0.0` firetruck-red, `P` (Pochven) deep rose-red, `A` (Abyssal) teal.
- `C1`–`C6` progress from sky-blue → cyan → emerald → amber → orange → orangy-red.
- Unknown/null → grey `#6b7280`.

### trueSecColor(sec: number): string
Maps a k-space true-security value (`universe_system.true_sec`) to a hex colour on EVE's standard gradient, keyed by one-decimal band: 1.0 cyan → 0.5 yellow → 0.1 red. Anything ≤ 0.0 (null-sec) is solid red `#f00000`. Used by the intel sidebar's security row (`IntelModule`).

### systemEffectColor(key: SystemEffectKey): string
Swatch colour for a W-space anomaly effect: magnetar→pink `#e06fdf`, redGiant→red `#d9534f`, pulsar→blue `#428bca`, wolfRayet→orange `#e28a0d`, cataclysmic→light-yellow `#ffffbb`, blackHole→black `#000000`. Used by `SystemNode`'s effect indicator square.

### systemStatusColor(status): string
Maps a `system_status` enum value to a hex colour (unknown→grey, friendly→blue, occupied→amber, hostile→red, empty→green, unscanned→purple).

### homeAccentColor(): string
Returns the amber/gold accent (`#fbbf24`) used to mark the map's designated Home system (accent ring + header icon in `SystemNode`). Deliberately distinct from the status palette so it never reads as a system status.

### noteSeverityColor(severity: NoteSeverity): string
Border colour for a map note (`MapNoteNode`), by `map_note_severity`: `neutral`→grey `#6b7280` (the file's default, so an unflagged note reads as "no severity"), `green`→`#22c55e`, `yellow`→`#eab308`, `red`→`#ef4444`.

### connectionStyle(edge: MapConnectionEdge): EdgeStyle
Returns `{ stroke, strokeWidth, strokeDasharray? }`. Scope sets the base colour; wormholes are recoloured by `massStatus` (fresh/reduced/critical). `eolStage` dashes the line — `critical` (1h) dashes tighter (`2 3`) than `eol` (4h, `6 4`) to read as more urgent; `jumpMassClass === 's'` thins the stroke (frigate/small holes).

### connectionBadges(edge: MapConnectionEdge): ConnectionBadge[]
Structured text badges for a connection: `STATIC` (user-designated static), jump-mass class (`S`/`M`/`L`/`XL`), then `EOL` (eol stage) or `EOL 1h` (critical stage). Each badge is `{ key, label, warn? }`. The small (`s`) size badge carries `warn: true` so `ConnectionEdge` renders it as a filled amber warning pill — small holes are easy to miss and people bring oversized ships. Rolling and preserve-mass are **not** returned here; `ConnectionEdge` renders them as standalone icons.

### Notes
- Kept out of Tailwind tokens because they're consumed inside SVG/inline styles.
