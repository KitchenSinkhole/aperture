## MetricsCharts

**Purpose:** Render-only history graphs for the admin metrics page — plots the server-derived `MetricHistory` as a grid of recharts line charts.
**File:** `src/components/admin/MetricsCharts.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| history | MetricHistory | yes | Server-derived series (`points` + `jobRuns`) for the selected `range` |

### Renders
A responsive grid (`md:2 / xl:3` cols) of `Card`s, one per metric: ESI request rate, ESI latency, ESI failure rate, route-calc latency, tracked characters, systems on maps, memory (RSS + heap), event-loop lag, and job success rate. Empty-state message when the range has no data yet.

### Behaviour & Interactions
- Pure presentational client component — no fetch, no mutations. All bucketing/derivation is done server-side in `loadMetricHistory`.
- X axis is a **fixed time domain** (`type="number" scale="time" domain={[fromMs, toMs]}`), so the full selected range is always shown with empty areas where no data exists — switching range changes the absolute span, not just the bucket width. Tick/tooltip labels are formatted from epoch `t` per `history.range` (clock time for `1h`/`24h`, date for `7d`/`30d`).
- `connectNulls={false}` so gaps (no data / zero-denominator interval) break the line rather than implying a value; `isAnimationActive={false}` matching `SystemGraphModule`.

### Depends On
- `recharts` (`LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`).
- `Card`/`CardHeader`/`CardTitle`/`CardContent` (`@/components/ui/card`).
- `ChartContainer` / `ChartTooltip` / `ChartTooltipContent` (`@/components/ui/chart`).
