'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchWormholeJumpInfo } from '@/lib/reference/client';
import { formatWormholeLifetime, formatWormholeMass } from '@/lib/eve/wormholeFormat';
import type { WormholeJumpInfoRow } from '@/types';

/**
 * Static reference dialog for wormhole jump data. Two sections: a
 * mass/lifetime/sig table for every WH code, and a statics overview grouped by
 * source class. Data is lazy-loaded on first open from `/api/reference/wormholes`
 * and memoised by the client helper, so reopens are instant.
 */
export function JumpInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<{ loading: boolean; rows: WormholeJumpInfoRow[] }>({
    loading: true,
    rows: [],
  });

  // Fetch once the dialog is first opened. The helper memoises, so this is a
  // no-op network-wise on subsequent opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchWormholeJumpInfo().then((result) => {
      if (cancelled) return;
      setState({ loading: false, rows: result.ok ? result.data : [] });
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const { loading, rows } = state;

  const statics = useMemo(() => groupBySource(rows), [rows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Jump info</DialogTitle>
          <DialogDescription>Wormhole mass, lifetime and statics reference.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            No wormhole reference data available.
          </div>
        ) : (
          <div className="flex max-h-[70vh] flex-col gap-5 overflow-auto">
            <MassTable rows={rows} />
            <StaticsOverview statics={statics} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MassTable({ rows }: { rows: WormholeJumpInfoRow[] }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium uppercase text-muted-foreground">Wormhole mass</h3>
      <div className="overflow-x-auto rounded-md ring-1 ring-foreground/10">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left">Code</th>
              <th className="px-2 py-1 text-left">Leads to</th>
              <th className="px-2 py-1 text-right">Total mass</th>
              <th className="px-2 py-1 text-right">Jump mass</th>
              <th className="px-2 py-1 text-right">Lifetime</th>
              <th className="px-2 py-1 text-right">Sig</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t border-foreground/10">
                <td className="px-2 py-1 font-mono">{r.code}</td>
                <td className="px-2 py-1">{r.targetClass ?? '—'}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{formatWormholeMass(r.totalMass)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{formatWormholeMass(r.jumpMass)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{formatWormholeLifetime(r.lifetimeMinutes)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{fmtSig(r.sigStrength)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StaticsOverview({
  statics,
}: {
  statics: { sourceClass: string; entries: { code: string; targetClass: string | null }[] }[];
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium uppercase text-muted-foreground">Statics by source class</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
        {statics.map((group) => (
          <div key={group.sourceClass} className="rounded-md ring-1 ring-foreground/10">
            <div className="border-b border-foreground/10 bg-muted/60 px-2 py-1 text-[11px] font-medium">
              {group.sourceClass}
            </div>
            <ul className="flex flex-col px-2 py-1 text-xs">
              {group.entries.map((e) => (
                <li key={e.code} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="font-mono">{e.code}</span>
                  <span className="text-muted-foreground">{e.targetClass ?? '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- formatting + grouping helpers -----------------------------------------

function fmtSig(value: number | null): string {
  if (value == null) return '—';
  return `${Math.round(value * 100)}%`;
}

/**
 * Group rows by source class for the statics overview. A multi-source hole
 * (e.g. S199 in L+0.0) appears under each of its classes. An unspecified source
 * (null — K162 + Drifter/shattered-access holes) is bucketed last under "Any".
 * Within a class, codes stay in the catalog's code order.
 */
function groupBySource(
  rows: WormholeJumpInfoRow[],
): { sourceClass: string; entries: { code: string; targetClass: string | null }[] }[] {
  const ANY = 'Any';
  const buckets = new Map<string, { code: string; targetClass: string | null }[]>();
  for (const r of rows) {
    const keys = r.sourceClasses && r.sourceClasses.length > 0 ? r.sourceClasses : [ANY];
    for (const key of keys) {
      const list = buckets.get(key) ?? [];
      list.push({ code: r.code, targetClass: r.targetClass });
      buckets.set(key, list);
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === ANY) return 1;
      if (b === ANY) return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([sourceClass, entries]) => ({ sourceClass, entries }));
}
