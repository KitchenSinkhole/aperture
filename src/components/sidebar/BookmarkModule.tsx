'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { effectiveBookmarkScheme } from '@/lib/bookmarking/scheme';
import { hopsFromHome } from '@/lib/map/subchainGraph';
import type { BookmarkInput, MapConnectionEdge, MapSignature, MapSystemNode } from '@/types';
import { useTraversals } from '@/components/map/MapPresenceContext';

type BookmarkModuleProps = {
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  signatures: MapSignature[];
  homeMapSystemId: string | null;
  viewerCharacters: { id: number; name: string }[];
};

type ResolveResult =
  | { kind: 'resolved'; here: MapSystemNode; cameFrom: MapSystemNode; connection: MapConnectionEdge }
  | { kind: 'drop' }
  | { kind: 'pending' };

/**
 * Resolve one viewer jump against current map state to the `wh` connection it
 * transited. `drop` = a gate link between the two systems (never a bookmark
 * candidate, ignored entirely); `pending` = the fold (systems/connection)
 * hasn't reached client state yet, so the caller should keep waiting.
 * Exported for unit testing.
 */
export function resolveBookmarkTransit(
  jump: { fromSystemId: number; toSystemId: number },
  systems: MapSystemNode[],
  connections: MapConnectionEdge[],
): ResolveResult {
  const source = systems.find((s) => s.systemId === jump.fromSystemId);
  const dest = systems.find((s) => s.systemId === jump.toSystemId);
  if (!source || !dest) return { kind: 'pending' };
  const incident = connections.filter(
    (c) =>
      (c.source === source.id && c.target === dest.id) ||
      (c.source === dest.id && c.target === source.id),
  );
  if (incident.some((c) => c.scope === 'stargate')) return { kind: 'drop' };
  const wh = incident.find((c) => c.scope === 'wh');
  if (!wh) return { kind: 'pending' };
  return { kind: 'resolved', here: dest, cameFrom: source, connection: wh };
}

type PendingJump = { characterId: number; fromSystemId: number; toSystemId: number };

/** The transit a displayed pair is frozen against — everything but the live-refreshed bound signatures. */
type Snapshot = {
  here: MapSystemNode;
  cameFrom: MapSystemNode;
  connection: MapConnectionEdge;
  hopsFromHome: ReadonlyMap<string, number>;
  homeMapSystemId: string | null;
};

async function copyBookmarkName(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('Bookmark name copied.');
  } catch {
    toast.error('Could not copy — select the text and copy it manually.');
  }
}

/** One row: a system-labelled bookmark name, clipped for display with the full string in the title and copied verbatim. */
function BookmarkRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
        <div className="truncate font-mono text-xs" title={value}>
          {value}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        aria-label={`Copy bookmark for ${label}`}
        onClick={() => void copyBookmarkName(value)}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * Sidebar panel showing the two bookmark names for the wormhole a viewer's
 * own pilot has just transited, one per endpoint system, each with a copy
 * button. Watches the viewer's own pilots via `useTraversals` (must be
 * rendered inside `MapPresenceProvider`).
 */
export function BookmarkModule({
  systems,
  connections,
  signatures,
  homeMapSystemId,
  viewerCharacters,
}: BookmarkModuleProps) {
  const [pending, setPending] = useState<PendingJump | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  // The traversal callback reads the latest props through this ref so a
  // re-render doesn't re-subscribe the listener.
  const latest = useRef({ systems, connections, homeMapSystemId, viewerCharacters });
  useEffect(() => {
    latest.current = { systems, connections, homeMapSystemId, viewerCharacters };
  });

  useTraversals((t) => {
    const { systems, connections, homeMapSystemId, viewerCharacters } = latest.current;
    if (!viewerCharacters.some((c) => c.id === t.characterId)) return; // only the viewer's own pilots

    const resolved = resolveBookmarkTransit(
      { fromSystemId: t.fromSystemId, toSystemId: t.toSystemId },
      systems,
      connections,
    );
    if (resolved.kind === 'drop') {
      setPending(null);
      return;
    }
    if (resolved.kind === 'resolved') {
      setSnapshot({
        here: resolved.here,
        cameFrom: resolved.cameFrom,
        connection: resolved.connection,
        hopsFromHome: hopsFromHome({ systems, connections, homeId: homeMapSystemId }),
        homeMapSystemId,
      });
      setPending(null);
      return;
    }
    // A fresh own-pilot jump supersedes any earlier still-buffered one.
    setPending({ characterId: t.characterId, fromSystemId: t.fromSystemId, toSystemId: t.toSystemId });
  });

  // Retries a buffered jump against the live render props — the traversal
  // can arrive before the `connection.create` it was broadcast after has
  // folded into client state. Adjusts state directly during render (React's
  // documented pattern for deriving state from props) rather than in an
  // effect, so a resolving jump promotes to `snapshot` in the same render
  // pass instead of an extra cascading one; `setPending(null)` makes the
  // branch a no-op on the next render, so it cannot loop.
  if (pending) {
    const resolved = resolveBookmarkTransit(
      { fromSystemId: pending.fromSystemId, toSystemId: pending.toSystemId },
      systems,
      connections,
    );
    if (resolved.kind === 'resolved') {
      setSnapshot({
        here: resolved.here,
        cameFrom: resolved.cameFrom,
        connection: resolved.connection,
        hopsFromHome: hopsFromHome({ systems, connections, homeId: homeMapSystemId }),
        homeMapSystemId,
      });
      setPending(null);
    } else if (resolved.kind === 'drop') {
      setPending(null);
    }
  }

  // Recomputed from the frozen snapshot on every render; unaffected by any
  // graph change except a signature bound to this hole's connection, since
  // `signatures` is the only live input and everything else in `snapshot`
  // stays fixed to the transit it was captured for.
  const boundSignatures = snapshot
    ? signatures.filter((s) => s.mapConnectionId === snapshot.connection.id)
    : [];
  const names = snapshot
    ? effectiveBookmarkScheme.names({
        here: snapshot.here,
        cameFrom: snapshot.cameFrom,
        connection: snapshot.connection,
        signatures: boundSignatures,
        hopsFromHome: snapshot.hopsFromHome,
        homeMapSystemId: snapshot.homeMapSystemId,
      } satisfies BookmarkInput)
    : null;

  const missingSig =
    snapshot !== null &&
    (!boundSignatures.some((s) => s.mapSystemId === snapshot.here.id) ||
      !boundSignatures.some((s) => s.mapSystemId === snapshot.cameFrom.id));

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        {!snapshot ? (
          <p className="text-xs text-muted-foreground">
            Jump through a wormhole to generate bookmark names.
          </p>
        ) : names === null ? (
          <p className="text-xs text-muted-foreground">
            The active naming scheme has no name for this wormhole.
          </p>
        ) : (
          <>
            <BookmarkRow label={snapshot.here.alias ?? snapshot.here.name} value={names.here} />
            <BookmarkRow
              label={snapshot.cameFrom.alias ?? snapshot.cameFrom.name}
              value={names.cameFrom}
            />
            {missingSig && (
              <p className="text-xs text-muted-foreground">
                A signature on this hole hasn&apos;t been entered yet — scan it in Aperture for a
                complete name.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
