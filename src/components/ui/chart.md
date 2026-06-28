## chart.tsx

**Purpose:** Trimmed shadcn-style Recharts wrapper — a themed responsive container plus a compact tooltip, used by the system-graph small-multiples module and the admin metrics page.
**File:** `src/components/ui/chart.tsx`

### ChartContainer
`ChartContainer({ className, children, ...divProps }): JSX` — wraps a single Recharts chart element in a `ResponsiveContainer` (fills the parent div, so give the div a height via `className`). Applies muted-foreground tick text and faint grid lines via Tailwind arbitrary selectors. `children` must be a single chart element (`<AreaChart>` etc.). Passes a positive `initialDimension` so recharts doesn't warn about a -1×-1 first render when the chart mounts synchronously (e.g. with server-provided data).

### ChartTooltipContent
`ChartTooltipContent({ active?, payload?, label?, valueFormatter?, labelFormatter? }): JSX | null` — pass as `content={<ChartTooltipContent valueFormatter={fmt} />}` to a Recharts `<Tooltip>`; Recharts injects `active`/`payload`/`label`. Renders a small popover-styled list of series swatches + values. `valueFormatter` formats numeric series values; `labelFormatter` formats a numeric `label` (e.g. an epoch-ms time-axis value into a readable timestamp).

### ChartTooltip
Re-export of Recharts' `Tooltip`.

### Depends On
- `recharts` (`ResponsiveContainer`, `Tooltip`)
- `@/lib/utils` (`cn`)
