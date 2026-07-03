## SystemGraphModule

**Purpose:** Dotlan-style activity graphs for the selected K-space system — small-multiple area charts over `ap_system_stats`.
**File:** `src/components/sidebar/SystemGraphModule.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| system | MapSystemNode \| null | yes | Selected system; null / wormhole → n/a state |

### Renders
A `Card` (panel name "System Graph" supplied by the surrounding `MapPanelGroup` chrome — no in-card title) with a 24h/7d/30d range toggle and three stacked mini area charts (Jumps, Ship kills, NPC kills), each themed a distinct color and carrying small muted tick labels on both axes (time on X, count on Y). Y-axis counts ≥1k are abbreviated (`1.3k`, `10k`, `2M`) so they fit the narrow axis gutter. Shows select-a-system / wormhole-n/a / loading / error states.

### Behaviour & Interactions
- K-space only: wormholes (via the shared `isWormholeSystem`) show "Not tracked in wormhole space." and never fetch.
- On system / range change, fetches `GET /api/system/<id>/graph?range=` (Abortable). Default range `24h`.
- The server series is sparse; `fillSeries` builds the contiguous bucket grid (UTC-aligned to match SQL `date_trunc`). Buckets with no row are filled with `null` (not `0`) and the `<Area>` uses `connectNulls={false}`, so a collection gap (e.g. the refresh job wasn't running that hour) breaks the line instead of reading as zero activity. A *present* bucket showing `0` is a genuine zero.

### Depends On
- `@/lib/map/stats` (`GraphRange`, `SystemStatsPoint` types), `@/lib/map/space` (`isWormholeSystem`), `@/components/ui/chart` (`ChartContainer`/`ChartTooltip`/`ChartTooltipContent`), `recharts` (`AreaChart`/`Area`/`XAxis`/`YAxis`), `@/components/ui/card`.
