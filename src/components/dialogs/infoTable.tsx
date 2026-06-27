/**
 * Shared scroll-table primitives for the map-info surfaces (Map info dialog
 * panels and the pilot roster popover). Plain styled table elements — no state.
 */

import { cn } from '@/lib/utils';

/**
 * Full-width compact `<table>`. Wrap in `ScrollTable` for a height-capped,
 * bordered scroll region. `compact` densifies all descendant cells (thinner
 * vertical padding) and drops the per-row top borders in one shot.
 */
export function InfoTable({
  compact = false,
  children,
}: {
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <table
      className={cn(
        'w-full text-xs',
        compact && '[&_td]:py-0.5 [&_th]:py-0.5 [&_tr]:border-t-0',
      )}
    >
      {children}
    </table>
  );
}

/** Height-capped, bordered scroll container — wrap an `InfoTable` (or its rows) in it. */
export function ScrollTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md ring-1 ring-foreground/10">
      {children}
    </div>
  );
}

export function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn('px-2 py-1.5 text-left font-medium', className)}>{children}</th>;
}

export function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn('px-2 py-1.5', className)}>{children}</td>;
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-8 text-center text-xs text-muted-foreground">{children}</div>;
}
