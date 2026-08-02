'use client';

import { Home } from 'lucide-react';
import { homeAccentColor, systemClassColor } from '@/components/map/styling';
import { systemDisplayName } from '@/lib/eve/drifterSystems';
import type { PublicMapEntrance } from '@/types';

// The ways into the chain, read as a departures board: where to undock for,
// what to scan when you get there, and where it comes out. For a guest with no
// map access this is the only part of the page that tells them what to do, so
// it leads rather than sitting in a sidebar.

/** How long each successive row waits before rising into place, in ms. */
const ROW_STAGGER_MS = 50;
/** Rows past this many drop the stagger — a long board should not crawl in. */
const MAX_STAGGERED_ROWS = 8;

export function EntrancesBoard({
  entrances,
  onHover,
}: {
  entrances: PublicMapEntrance[];
  /** Fires with the hovered row's `ap_map_system.id`, or null on leave. */
  onHover: (mapSystemId: string | null) => void;
}) {
  return (
    <section
      aria-label="Ways into the chain"
      className="flex min-h-0 flex-col border-spec-line bg-spec-rail"
    >
      <header className="flex items-baseline justify-between border-b border-spec-line px-4 py-3">
        <h2 className="font-spec-mono text-[10px] uppercase tracking-[0.18em] text-spec-dim">
          Directions in
        </h2>
        <span className="font-spec-mono text-[10px] tabular-nums text-spec-dim">
          {entrances.length}
        </span>
      </header>

      {entrances.length === 0 ? (
        <p className="px-4 py-6 text-sm text-spec-dim">
          No k-space entrance is on the map right now.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {entrances.map((e, i) => (
            <EntranceRow
              key={e.connectionId}
              entrance={e}
              index={Math.min(i, MAX_STAGGERED_ROWS)}
              onHover={onHover}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function EntranceRow({
  entrance,
  index,
  onHover,
}: {
  entrance: PublicMapEntrance;
  index: number;
  onHover: (mapSystemId: string | null) => void;
}) {
  // The same class palette the canvas tiles use, so an `H` reads the one colour
  // across the whole page.
  const accent = systemClassColor(entrance.security);
  const home = homeAccentColor();

  return (
    <li
      className="animate-spec-row-in border-b border-l-2 border-b-spec-line px-4 py-3 transition-colors hover:bg-white/[0.03] focus-within:bg-white/[0.03]"
      style={{
        animationDelay: `${index * ROW_STAGGER_MS}ms`,
        borderLeftColor: entrance.leadsHome ? home : 'transparent',
      }}
      onMouseEnter={() => onHover(entrance.mapSystemId)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(entrance.mapSystemId)}
      onBlur={() => onHover(null)}
      tabIndex={0}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-spec-mono text-[18px] font-semibold tracking-tight text-spec-text">
          {systemDisplayName(entrance.systemId, entrance.name)}
        </span>
        <span
          className="shrink-0 font-spec-mono text-xs font-bold"
          style={{ color: accent }}
          title={entrance.regionName}
        >
          {entrance.security ?? entrance.trueSec?.toFixed(1) ?? '?'}
        </span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-spec-mono text-[10px] uppercase tracking-[0.18em] text-spec-dim">
          Scan
        </span>
        {entrance.sigId ? (
          <span className="font-spec-mono text-[15px] font-semibold tracking-wide text-spec-text">
            {entrance.sigId.slice(0, 3)}
          </span>
        ) : (
          <span
            className="font-spec-mono text-[15px] text-spec-dim"
            title="Nobody has scanned this side yet"
          >
            —
          </span>
        )}
        {entrance.leadsTo && (
          <span
            className="ml-auto flex shrink-0 items-baseline font-spec-mono text-xs font-bold"
            title={entrance.leadsHome ? 'Leads toward home' : 'Leads to'}
          >
            <span className="text-spec-dim">→ </span>
            {entrance.leadsHome && (
              <Home
                className="mr-1 size-3 self-center"
                style={{ color: home }}
                aria-label="Leads toward home"
              />
            )}
            <span style={{ color: systemClassColor(entrance.leadsTo) }}>{entrance.leadsTo}</span>
            {entrance.farSigId && (
              <span className="ml-1.5 text-spec-dim">{entrance.farSigId.slice(0, 3)}</span>
            )}
          </span>
        )}
      </div>

      <p className="mt-1 font-spec-mono text-xs text-spec-dim">
        {entrance.route
          ? `${entrance.route.jumps} ${entrance.route.jumps === 1 ? 'jump' : 'jumps'} from ${entrance.route.hubName}`
          : 'No gate route from a trade hub'}
      </p>
    </li>
  );
}
