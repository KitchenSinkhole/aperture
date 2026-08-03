'use client';

import { useEffect, useMemo, useState } from 'react';
import { EntrancesBoard } from './EntrancesBoard';
import { IntroCard } from './IntroCard';
import { PromoBar } from './PromoBar';
import { SpectatorMap, type SpectatorHighlight } from './SpectatorMap';
import { usePublicSnapshot, type PublicFeedStatus } from './usePublicSnapshot';
import type { PublicMapEntrance, PublicMapViewData } from '@/types';

// The spectator shell: promo bar, entrances board, chain, status strip. Built
// for an audience rather than an operator — nothing here edits anything, and
// the only interaction is the board-to-canvas route highlight. Liveness comes
// from `usePublicSnapshot`; this component owns nothing about the transport.

const NO_HIGHLIGHT: SpectatorHighlight = { systemIds: [], connectionIds: [] };

export function SpectatorView({
  token,
  initialData,
}: {
  token: string;
  initialData: PublicMapViewData;
}) {
  // Rows are identified by connection id, not held as objects, so a refetch
  // that drops or rewrites an entrance clears the highlight rather than
  // lighting a stale route.
  const [hoveredEntranceId, setHoveredEntranceId] = useState<string | null>(null);
  const [pinnedEntranceId, setPinnedEntranceId] = useState<string | null>(null);
  const { data, status, updatedAt } = usePublicSnapshot(token, initialData);
  const pilotCount = countPilots(data.presence);

  // Hover wins over a pin, so pointing at a second row previews it without
  // discarding what the reader pinned.
  const activeEntranceId = hoveredEntranceId ?? pinnedEntranceId;
  const highlight = useMemo(
    () => entranceHighlight(data.entrances.find((e) => e.connectionId === activeEntranceId)),
    [data.entrances, activeEntranceId],
  );

  const clearHighlight = () => {
    setHoveredEntranceId(null);
    setPinnedEntranceId(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-spec-field text-spec-text">
      <PromoBar mapName={data.map.name} shareLabel={data.map.shareLabel} />

      <div className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        {/* Below lg the board sits under the map, capped at two fifths of the
            split so the chain keeps the other three. The cap is a share of this
            row, not of the viewport, so the promo bar and a footer that wraps
            on a narrow screen come out of both sides evenly. */}
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-spec-line lg:max-h-none lg:w-[19rem] lg:border-r lg:border-t-0">
          <EntrancesBoard
            entrances={data.entrances}
            pinnedEntranceId={pinnedEntranceId}
            onHover={setHoveredEntranceId}
            onPin={(connectionId) =>
              setPinnedEntranceId((current) => (current === connectionId ? null : connectionId))
            }
          />
        </div>

        <div className="relative min-h-0 flex-1">
          {status === 'ended' ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <p className="font-spec-mono text-sm uppercase tracking-[0.18em] text-spec-text">
                This share link has ended
              </p>
              <p className="text-sm text-spec-dim">Ask whoever shared it for a fresh one.</p>
            </div>
          ) : data.systems.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-spec-dim">
              Nothing is mapped here yet.
            </p>
          ) : (
            <SpectatorMap data={data} highlight={highlight} onPaneClick={clearHighlight} />
          )}
          {status !== 'ended' && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex justify-start">
              <IntroCard />
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-spec-line px-5 py-2 font-spec-mono text-[13px] text-spec-dim">
        <FeedIndicator status={status} updatedAt={updatedAt} />
        <span aria-hidden>·</span>
        <span className="tabular-nums">
          {data.systems.length} {data.systems.length === 1 ? 'system' : 'systems'}
        </span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">
          {data.connections.length}{' '}
          {data.connections.length === 1 ? 'connection' : 'connections'}
        </span>
        {pilotCount !== null && (
          <>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {pilotCount} {pilotCount === 1 ? 'pilot' : 'pilots'}
            </span>
          </>
        )}
        <span className="ml-auto uppercase tracking-[0.18em]">Read-only public view</span>
      </footer>
    </div>
  );
}

function FeedIndicator({
  status,
  updatedAt,
}: {
  status: PublicFeedStatus;
  updatedAt: number;
}) {
  const seconds = useElapsedSeconds(updatedAt);

  if (status === 'ended') {
    return (
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-spec-dim" aria-hidden />
        ENDED
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5" title={`Updated ${seconds}s ago`}>
      <span
        className={
          status === 'live'
            ? 'animate-spec-pulse size-2 rounded-full bg-spec-live'
            : 'size-2 rounded-full bg-spec-dim'
        }
        aria-hidden
      />
      {status === 'live' ? 'LIVE' : 'DELAYED'} · {seconds}s ago
    </span>
  );
}

/**
 * Everything one entrance lights up: every hop of its way to Home, plus the
 * k-space system it starts in. An entrance with no way home lights only its own
 * hole — there is no onward route to trace.
 */
function entranceHighlight(entrance: PublicMapEntrance | undefined): SpectatorHighlight {
  if (!entrance) return NO_HIGHLIGHT;
  const hops = entrance.pathHome;
  return {
    systemIds: [entrance.mapSystemId, ...(hops?.map((h) => h.mapSystemId) ?? [])],
    connectionIds: hops ? hops.map((h) => h.connectionId) : [entrance.connectionId],
  };
}

/** Seconds elapsed since `since`, ticking every second. */
function useElapsedSeconds(since: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((now - since) / 1000));
}

/** Total tracked pilots on the chain, or null when the token publishes no roster. */
function countPilots(presence: PublicMapViewData['presence']): number | null {
  if (presence.mode === 'none') return null;
  if (presence.mode === 'full') return presence.pilots.length;
  return presence.systems.reduce((sum, s) => sum + s.count, 0);
}
