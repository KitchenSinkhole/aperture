'use client';

import { Home } from 'lucide-react';
import { homeAccentColor, systemClassColor } from '@/components/map/styling';
import { systemDisplayName } from '@/lib/eve/drifterSystems';
import type { PublicMapEntrance, PublicMapEntranceHop } from '@/types';

// The ways into the chain, read as a departures board: where to undock for,
// what to scan when you get there, and where it comes out. For a guest with no
// map access this is the only part of the page that tells them what to do, so
// it leads rather than sitting in a sidebar.
//
// Entrances that reach the map's Home render turn-by-turn, hop by hop, so a
// pilot can confirm they are on track at every jump rather than guessing past
// the first hole. Entrances that do not are one line each — genuinely
// different content, so they render under a separate heading rather than
// blending into one undifferentiated list.
//
// Every row is a button, not a hover target with a tabindex: this link is built
// to be pasted into Discord, and a phone has no hover to give. Tapping pins the
// route on the canvas.

/** How long each successive row waits before rising into place, in ms. */
const ROW_STAGGER_MS = 50;
/** Rows past this many drop the stagger — a long board should not crawl in. */
const MAX_STAGGERED_ROWS = 8;
/** Hop lines shown before a home route's middle jumps collapse into one line. */
const MAX_VISIBLE_HOPS = 4;

export function EntrancesBoard({
  entrances,
  pinnedEntranceId,
  onHover,
  onPin,
}: {
  entrances: PublicMapEntrance[];
  /** `connectionId` of the row whose route is pinned, if any. */
  pinnedEntranceId: string | null;
  /** Fires with the hovered or focused row's `connectionId`, or null on leave. */
  onHover: (connectionId: string | null) => void;
  /** Fires with the tapped row's `connectionId`; the owner toggles the pin. */
  onPin: (connectionId: string) => void;
}) {
  const homeEntrances = entrances.filter((e) => e.pathHome !== null);
  const otherEntrances = entrances.filter((e) => e.pathHome === null);
  const grouped = homeEntrances.length > 0;

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
        <div className="min-h-0 flex-1 overflow-y-auto">
          {grouped ? (
            <>
              <GroupHeading label="Ways to home" />
              <ul>
                {homeEntrances.map((e, i) => (
                  <EntranceRow
                    key={e.connectionId}
                    entrance={e}
                    index={Math.min(i, MAX_STAGGERED_ROWS)}
                    pinned={e.connectionId === pinnedEntranceId}
                    onHover={onHover}
                    onPin={onPin}
                  />
                ))}
              </ul>
              {otherEntrances.length > 0 && (
                <>
                  <GroupHeading label="Other entrances" />
                  <ul>
                    {otherEntrances.map((e, i) => (
                      <EntranceRow
                        key={e.connectionId}
                        entrance={e}
                        index={Math.min(homeEntrances.length + i, MAX_STAGGERED_ROWS)}
                        pinned={e.connectionId === pinnedEntranceId}
                        onHover={onHover}
                        onPin={onPin}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <ul>
              {entrances.map((e, i) => (
                <EntranceRow
                  key={e.connectionId}
                  entrance={e}
                  index={Math.min(i, MAX_STAGGERED_ROWS)}
                  pinned={e.connectionId === pinnedEntranceId}
                  onHover={onHover}
                  onPin={onPin}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function GroupHeading({ label }: { label: string }) {
  return (
    <h3 className="border-b border-spec-line px-4 py-2 font-spec-mono text-[11px] uppercase tracking-[0.18em] text-spec-dim">
      {label}
    </h3>
  );
}

function EntranceRow({
  entrance,
  index,
  pinned,
  onHover,
  onPin,
}: {
  entrance: PublicMapEntrance;
  index: number;
  pinned: boolean;
  onHover: (connectionId: string | null) => void;
  onPin: (connectionId: string) => void;
}) {
  // The same class palette the canvas tiles use, so an `H` reads the one colour
  // across the whole page.
  const accent = systemClassColor(entrance.security);
  const home = homeAccentColor();

  return (
    <li
      className="animate-spec-row-in border-b border-l-2 border-b-spec-line"
      style={{
        animationDelay: `${index * ROW_STAGGER_MS}ms`,
        borderLeftColor: entrance.pathHome ? home : 'transparent',
      }}
    >
      <button
        type="button"
        aria-pressed={pinned}
        className={`block w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.03] ${pinned ? 'bg-white/[0.06]' : ''}`}
        onMouseEnter={() => onHover(entrance.connectionId)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(entrance.connectionId)}
        onBlur={() => onHover(null)}
        onClick={() => onPin(entrance.connectionId)}
      >
        <span className="flex items-baseline gap-2">
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
        </span>

        <span className="mt-1 block font-spec-mono text-xs text-spec-dim">
          {entrance.route
            ? `${entrance.route.jumps} ${entrance.route.jumps === 1 ? 'jump' : 'jumps'} from ${entrance.route.hubName}`
            : 'No gate route from a trade hub'}
        </span>

        {entrance.pathHome ? (
          <HopList hops={entrance.pathHome} home={home} />
        ) : (
          <span className="mt-1.5 flex items-baseline gap-2">
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
                title="Leads to"
              >
                <span aria-hidden className="text-spec-dim">
                  →{' '}
                </span>
                <span style={{ color: systemClassColor(entrance.leadsTo) }}>{entrance.leadsTo}</span>
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

type HopRow =
  | { kind: 'hop'; hop: PublicMapEntranceHop; isLast: boolean }
  | { kind: 'collapsed'; count: number };

/** Caps a home route's rendered lines at `MAX_VISIBLE_HOPS`, collapsing the middle. */
function hopRows(hops: PublicMapEntranceHop[]): HopRow[] {
  if (hops.length <= MAX_VISIBLE_HOPS) {
    return hops.map((hop, i) => ({ kind: 'hop', hop, isLast: i === hops.length - 1 }));
  }
  return [
    { kind: 'hop', hop: hops[0]!, isLast: false },
    { kind: 'hop', hop: hops[1]!, isLast: false },
    { kind: 'collapsed', count: hops.length - 3 },
    { kind: 'hop', hop: hops[hops.length - 1]!, isLast: true },
  ];
}

/**
 * Turn-by-turn hops for a home-leading entrance. When every hop's `sigId` is
 * null — the token withholds codes, or nobody has scanned anything on this
 * route — the sig column drops entirely and the row reads as a plain
 * system-name path rather than a set of things to scan.
 */
function HopList({ hops, home }: { hops: PublicMapEntranceHop[]; home: string }) {
  const scannable = hops.some((h) => h.sigId !== null);

  return (
    <span className="mt-1.5 flex flex-col gap-1">
      {hopRows(hops).map((row, i) =>
        row.kind === 'collapsed' ? (
          <span key={`collapsed-${i}`} className="pl-1 font-spec-mono text-xs text-spec-dim">
            ⋯ {row.count} more {row.count === 1 ? 'jump' : 'jumps'}
          </span>
        ) : (
          <span
            key={row.hop.connectionId}
            className="flex items-baseline gap-2 font-spec-mono text-[13px]"
          >
            {scannable &&
              (row.hop.sigId ? (
                <span className="w-6 shrink-0 font-semibold text-spec-text">
                  {row.hop.sigId.slice(0, 3)}
                </span>
              ) : (
                <span
                  className="w-8 shrink-0 text-spec-dim"
                  title="Nobody has scanned this side yet"
                >
                  —
                </span>
              ))}
            <span aria-hidden className="text-spec-dim">
              →
            </span>
            <span
              className="shrink-0 font-bold"
              style={{ color: systemClassColor(row.hop.security) }}
            >
              {row.hop.security ?? '?'}
            </span>
            {row.hop.tag && (
              <span
                className="shrink-0 font-bold"
                style={{ color: systemClassColor(row.hop.security) }}
              >
                {row.hop.tag}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-spec-text">
              {systemDisplayName(row.hop.systemId, row.hop.name)}
            </span>
            {row.isLast && (
              <Home className="size-3 shrink-0" style={{ color: home }} aria-label="Home" />
            )}
          </span>
        ),
      )}
    </span>
  );
}
