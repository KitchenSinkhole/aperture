'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { MetricHistory, MetricRange } from '@/types';

// Render-only history graphs for the admin metrics page. Receives the
// server-derived `MetricHistory` and plots one card per metric with recharts.
// The X axis is a fixed time domain (`[fromMs, toMs]`) so the full selected range
// is always shown with empty areas where no data exists — not just the span the
// data happens to cover. All bucketing/derivation is done server-side in
// `loadMetricHistory`; this component only formats and draws.

/** X-axis tick / tooltip label formatting per range: clock time for short ranges, a date for long. */
function formatLabel(t: number, range: MetricRange): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (range === '1h' || range === '24h') return `${hh}:${mm}`;
  if (range === '7d') return `${md} ${hh}:00`;
  return md;
}

function fmtNumber(v: number): string {
  return `${Number(v.toFixed(1))}`;
}
function fmtMs(v: number): string {
  return `${Math.round(v)} ms`;
}
function fmtPct(v: number): string {
  return `${Number(v.toFixed(1))}%`;
}
function fmtMb(v: number): string {
  return `${Math.round(v)} MB`;
}

type Series = { key: string; label: string; color: string };

function MetricChart({
  title,
  data,
  domain,
  series,
  valueFormatter,
  labelFormatter,
}: {
  title: string;
  data: readonly Record<string, number | null>[];
  domain: [number, number];
  series: Series[];
  valueFormatter: (v: number) => string;
  labelFormatter: (t: number) => string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer className="h-40">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 2, left: 2 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              allowDataOverflow
              tickFormatter={labelFormatter}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tick={{ fontSize: 9, fill: 'var(--color-muted-foreground)' }}
              height={14}
            />
            <YAxis
              width={36}
              tickLine={false}
              axisLine={false}
              tickCount={4}
              tickFormatter={(v: number) => valueFormatter(v)}
              tick={{ fontSize: 9, fill: 'var(--color-muted-foreground)' }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent valueFormatter={valueFormatter} labelFormatter={labelFormatter} />
              }
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const COLORS = {
  sky: '#38bdf8',
  rose: '#fb7185',
  amber: '#fbbf24',
  emerald: '#34d399',
  violet: '#a78bfa',
  slate: '#94a3b8',
} as const;

export function MetricsCharts({ history }: { history: MetricHistory }) {
  const { range, fromMs, toMs, points, jobRuns } = history;
  const domain: [number, number] = [fromMs, toMs];
  const labelFormatter = (t: number) => formatLabel(t, range);

  if (points.length === 0 && jobRuns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No metrics recorded for this range yet. The snapshot job samples once a minute.
      </p>
    );
  }

  const common = { domain, labelFormatter } as const;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <MetricChart
        {...common}
        title="ESI request rate (req/min)"
        data={points}
        valueFormatter={fmtNumber}
        series={[{ key: 'esiRequestRate', label: 'req/min', color: COLORS.sky }]}
      />
      <MetricChart
        {...common}
        title="ESI latency (avg)"
        data={points}
        valueFormatter={fmtMs}
        series={[{ key: 'esiAvgLatencyMs', label: 'latency', color: COLORS.sky }]}
      />
      <MetricChart
        {...common}
        title="ESI failure rate"
        data={points}
        valueFormatter={fmtPct}
        series={[{ key: 'esiFailurePct', label: 'failure %', color: COLORS.rose }]}
      />
      <MetricChart
        {...common}
        title="Route-calc latency (avg)"
        data={points}
        valueFormatter={fmtMs}
        series={[{ key: 'routeAvgLatencyMs', label: 'latency', color: COLORS.violet }]}
      />
      <MetricChart
        {...common}
        title="Tracked characters"
        data={points}
        valueFormatter={fmtNumber}
        series={[{ key: 'trackedCharacters', label: 'characters', color: COLORS.emerald }]}
      />
      <MetricChart
        {...common}
        title="Systems on maps"
        data={points}
        valueFormatter={fmtNumber}
        series={[{ key: 'visibleSystems', label: 'systems', color: COLORS.emerald }]}
      />
      <MetricChart
        {...common}
        title="Memory"
        data={points}
        valueFormatter={fmtMb}
        series={[
          { key: 'processRssMb', label: 'RSS', color: COLORS.amber },
          { key: 'processHeapUsedMb', label: 'heap used', color: COLORS.sky },
        ]}
      />
      <MetricChart
        {...common}
        title="Event-loop lag"
        data={points}
        valueFormatter={fmtMs}
        series={[{ key: 'eventLoopLagMs', label: 'lag', color: COLORS.rose }]}
      />
      <MetricChart
        {...common}
        title="Job success rate"
        data={jobRuns}
        valueFormatter={fmtPct}
        series={[{ key: 'successPct', label: 'success %', color: COLORS.emerald }]}
      />
    </div>
  );
}
