import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth/rights';
import { auth } from '@/lib/auth';
import { loadMetricHistory } from '@/lib/metrics/history';
import { MetricsCharts } from '@/components/admin/MetricsCharts';
import { cn } from '@/lib/utils';
import type { MetricRange } from '@/types';

const RANGES: MetricRange[] = ['1h', '24h', '7d', '30d'];

function parseRange(value: string | undefined): MetricRange {
  return RANGES.includes(value as MetricRange) ? (value as MetricRange) : '24h';
}

export default async function AdminMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await auth();
  if (!(await isAdmin(session))) redirect('/maps');

  const range = parseRange((await searchParams).range);
  const history = await loadMetricHistory(range);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Metrics</h1>
        <nav aria-label="Time range" className="inline-flex overflow-hidden rounded-md ring-1 ring-foreground/15">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={{ pathname: '/admin/metrics', query: { range: r } }}
              aria-current={r === range ? 'page' : undefined}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                r === range
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {r}
            </Link>
          ))}
        </nav>
      </header>
      <MetricsCharts history={history} />
    </section>
  );
}
