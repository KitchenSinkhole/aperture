'use client';

import { useEffect, useState } from 'react';
import { EntrancesBoard } from './EntrancesBoard';
import { IntroCard } from './IntroCard';
import { PromoBar } from './PromoBar';
import { SpectatorMap } from './SpectatorMap';
import { usePublicSnapshot, type PublicFeedStatus } from './usePublicSnapshot';
import type { PublicMapViewData } from '@/types';

// The spectator shell: promo bar, entrances board, chain, status strip. Built
// for an audience rather than an operator — nothing here edits anything, and
// the only interaction is the board-to-canvas highlight. Liveness comes from
// `usePublicSnapshot`; this component owns nothing about the transport.

export function SpectatorView({
  token,
  initialData,
}: {
  token: string;
  initialData: PublicMapViewData;
}) {
  const [highlightedSystemId, setHighlightedSystemId] = useState<string | null>(null);
  const { data, status, updatedAt } = usePublicSnapshot(token, initialData);
  const pilotCount = countPilots(data.presence);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-spec-field text-spec-text">
      <PromoBar mapName={data.map.name} shareLabel={data.map.shareLabel} />

      <div className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        {/* Below lg the board sits under the map, capped so the chain keeps
            the majority of a phone screen. */}
        <div className="max-h-[45vh] shrink-0 overflow-y-auto border-t border-spec-line lg:max-h-none lg:w-[19rem] lg:border-r lg:border-t-0">
          <EntrancesBoard entrances={data.entrances} onHover={setHighlightedSystemId} />
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
            <SpectatorMap data={data} highlightedSystemId={highlightedSystemId} />
          )}
          {status !== 'ended' && (
            <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex justify-end">
              <IntroCard />
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-spec-line px-5 py-2 font-spec-mono text-[11px] text-spec-dim">
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
