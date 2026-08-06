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
Maps a k-space true-security value (`universe_system.true_sec`) to a hex colour on CCP's canonical security-status gradient, keyed by the displayed value (`sec` passed through `roundSecurity`): 1.0 blue → 0.5 yellow → 0.1 red. Anything that rounds to ≤ 0.0 (null-sec) is the deep magenta terminal colour `#8D3163`. Used by the intel sidebar's security row (`IntelModule`) and, via `systemSecurityColor`, the routes panel.

### systemSecurityColor(label: string | null | undefined, securityStatus: number | null | undefined): string
Picks a system's colour by space type: k-space labels (`H`/`L`/`0.0`) with a raw `securityStatus` use `trueSecColor`'s fine-grained gradient; every other label (wormhole classes, Pochven, Abyssal, unknown) falls back to `systemClassColor`. Used by `RoutePlannerModule` for destination rows, hop markers/tooltips, and the search dropdown.

### systemEffectColor(key: SystemEffectKey): string
Swatch colour for a W-space anomaly effect: magnetar→pink `#e06fdf`, redGiant→red `#d9534f`, pulsar→blue `#428bca`, wolfRayet→orange `#e28a0d`, cataclysmic→light-yellow `#ffffbb`, blackHole→black `#000000`. Used by `SystemNode`'s effect indicator square.

### systemStatusColor(status): string
Maps a `system_status` enum value to a hex colour (unknown→grey, friendly→blue, occupied→amber, hostile→red, empty→green, unscanned→purple).

### homeAccentColor(): string
Returns the amber/gold accent (`#fbbf24`) used to mark the map's designated Home system (accent ring + header icon in `SystemNode`). Deliberately distinct from the status palette so it never reads as a system status.

### noteSeverityColor(severity: NoteSeverity): string
Border colour for a map note (`MapNoteNode`), by `map_note_severity`: `neutral`→grey `#6b7280` (the file's default, so an unflagged note reads as "no severity"), `green`→`#22c55e`, `yellow`→`#eab308`, `red`→`#ef4444`.

### connectionStyle(edge: Pick&lt;MapConnectionEdge, 'scope' | 'massStatus' | 'jumpMassClass' | 'eolStage'&gt;): EdgeStyle
Returns `{ stroke, strokeWidth, strokeDasharray? }`. Scope sets the base colour; wormholes are recoloured by `massStatus` (fresh/reduced/critical). `eolStage` dashes the line — `expired` sparsest (`1 4`, barely-there), `critical` (1h) tighter (`2 3`) than `eol` (4h, `6 4`) — to read as progressively more urgent; `jumpMassClass === 's'` thins the stroke (frigate/small holes).

### connectionBadges(edge: Pick&lt;MapConnectionEdge, 'isStatic' | 'jumpMassClass' | 'eolStage'&gt;): ConnectionBadge[]
Structured text badges for a connection: `STATIC` (user-designated static), jump-mass class (`S`/`M`/`L`/`XL`), then `EOL` (eol stage), `EOL 1h` (critical stage), or `EXPIRED` (manual expired stage). Each badge is `{ key, label, tone? }`. The small (`s`) size badge carries `tone: 'warn'` (filled amber pill — small holes are easy to miss) and the `EXPIRED` badge `tone: 'danger'` (filled red pill — do-not-jump hazard); `ConnectionEdge`/`SystemOverlay` colour the pill by tone. Rolling and preserve-mass are **not** returned here; `ConnectionEdge` renders them as standalone icons.

### connectionBubbleColor(): string
Returns the cold ice blue (`#9ec9f0`) used for a bubbled connection end — the `ConnectionBubble` ring and wash. Held apart from the mass/scope palette so a bubble never reads as connection state, and high enough in luminance to carry against the canvas at the low alphas the ring fill and wash use.

### connectionEndpointColor(): string
Returns the neutral slate (`#94a3b8`) used for the `ConnectionEndpoint` hover dot. Deliberately not the bubble hue: the dot marks where a control is, not what state the end is in, and the two share a spot.

### Notes
- Kept out of Tailwind tokens because they're consumed inside SVG/inline styles.
