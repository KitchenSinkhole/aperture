'use client';

import * as React from 'react';
import { ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';

import { cn } from '@/lib/utils';

// Trimmed shadcn-style chart wrapper. Provides a themed responsive
// container and a compact tooltip; charts compose Recharts primitives directly.
// Kept minimal — the only consumer is the system-graph small-multiples module.

type ChartContainerProps = React.ComponentProps<'div'> & {
  children: React.ReactElement;
};

export function ChartContainer({ className, children, ...props }: ChartContainerProps) {
  return (
    <div
      data-slot="chart"
      className={cn(
        'w-full text-[10px]',
        '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground',
        '[&_.recharts-cartesian-grid_line]:stroke-foreground/10',
        '[&_.recharts-surface]:overflow-visible',
        className,
      )}
      {...props}
    >
      {/* `initialDimension` defaults to -1×-1, which recharts warns about on the
          first synchronous render (before the ResizeObserver measures). A positive
          placeholder silences that; the observer corrects it on the next frame. */}
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 160 }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

type TooltipPayloadItem = {
  value?: number | string;
  name?: string | number;
  color?: string;
  dataKey?: string | number;
};

/**
 * Pass as `content={<ChartTooltipContent label="…" />}` to a Recharts
 * `<Tooltip>`; Recharts injects `active`/`payload`/`label` on render.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  valueFormatter?: (value: number) => string;
  labelFormatter?: (label: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const shownLabel =
    typeof label === 'number' && labelFormatter ? labelFormatter(label) : label;
  return (
    <div className="rounded-md border border-border bg-popover px-2 py-1 text-[10px] shadow-md">
      {shownLabel != null ? (
        <p className="mb-0.5 font-medium text-muted-foreground">{shownLabel}</p>
      ) : null}
      {payload.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ backgroundColor: item.color }} />
          <span className="text-muted-foreground">{item.name}</span>
          <span className="ml-auto font-mono tabular-nums">
            {typeof item.value === 'number' && valueFormatter
              ? valueFormatter(item.value)
              : item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export const ChartTooltip = RechartsTooltip;
