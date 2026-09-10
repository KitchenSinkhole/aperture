'use client';

import { useEffect, useState } from 'react';
import { BUFFER_TTL_MS, resolveTransit } from '@/lib/map/transitResolve';
import { hopsFromHome } from '@/lib/map/subchainGraph';
import type { MapConnectionEdge, MapSystemNode } from '@/types';
import { useTraversals, type Traversal } from './MapPresenceContext';

/** The transit a displayed bookmark pair is frozen against — everything but the live-refreshed bound signatures. */
export type BookmarkTransit = {
  here: MapSystemNode;
  cameFrom: MapSystemNode;
  connection: MapConnectionEdge;
  connections: MapConnectionEdge[];
  hopsFromHome: ReadonlyMap<string, number>;
  homeMapSystemId: string | null;
};

/** A viewer jump waiting for its folded systems/connection to reach client state. */
type PendingJump = {
  fromSystemId: number;
  toSystemId: number;
  /** ms epoch the jump was observed; the entry is forgotten after `BUFFER_TTL_MS`. */
  at: number;
};

/**
 * Tracks the wormhole the viewer's own pilots have most recently transited.
 *
 * Returns the frozen transit context plus the traversal handler that feeds it.
 * The handler must be wired to `useTraversals` by a component mounted inside
 * `MapPresenceProvider` (`BookmarkTransitBridge`), while this hook itself is
 * called by an always-mounted owner, so no jump is missed while the panel that
 * displays the result is tabbed away or hidden.
 */
export function useBookmarkTransit(args: {
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  homeMapSystemId: string | null;
  viewerCharacters: { id: number; name: string }[];
}): { transit: BookmarkTransit | null; onTraversal: (t: Traversal) => void } {
  const { systems, connections, homeMapSystemId, viewerCharacters } = args;
  const [pending, setPending] = useState<PendingJump | null>(null);
  const [transit, setTransit] = useState<BookmarkTransit | null>(null);

  const capture = (
    here: MapSystemNode,
    cameFrom: MapSystemNode,
    connection: MapConnectionEdge,
    liveConnections: MapConnectionEdge[],
  ): BookmarkTransit => ({
    here,
    cameFrom,
    connection,
    connections: liveConnections,
    hopsFromHome: hopsFromHome({ systems, connections: liveConnections, homeId: homeMapSystemId }),
    homeMapSystemId,
  });

  // `useTraversals` invokes only the latest registered callback, so this closure
  // reads last-committed props without a ref of its own.
  const onTraversal = (t: Traversal) => {
    if (!viewerCharacters.some((c) => c.id === t.characterId)) return; // only the viewer's own pilots

    const resolved = resolveTransit(
      { fromSystemId: t.fromSystemId, toSystemId: t.toSystemId },
      systems,
      connections,
    );
    if (resolved.kind === 'drop') {
      setPending(null);
      return;
    }
    if (resolved.kind === 'resolved') {
      setTransit(capture(resolved.here, resolved.cameFrom, resolved.connection, connections));
      setPending(null);
      return;
    }
    // A fresh own-pilot jump supersedes any earlier still-buffered one.
    setPending({ fromSystemId: t.fromSystemId, toSystemId: t.toSystemId, at: Date.now() });
  };

  // Retries a buffered jump against the live render props — the traversal can
  // arrive before the `connection.create` it was broadcast after has folded into
  // client state. Adjusts state directly during render (React's documented
  // pattern for deriving state from props) rather than in an effect, so a
  // resolving jump promotes in the same render pass instead of an extra
  // cascading one; `setPending(null)` makes the branch a no-op on the next
  // render, so it cannot loop.
  if (pending) {
    const resolved = resolveTransit(
      { fromSystemId: pending.fromSystemId, toSystemId: pending.toSystemId },
      systems,
      connections,
    );
    if (resolved.kind === 'resolved') {
      setTransit(capture(resolved.here, resolved.cameFrom, resolved.connection, connections));
      setPending(null);
    } else if (resolved.kind === 'drop') {
      setPending(null);
    }
  }

  // Forgets a jump whose fold never arrives within `BUFFER_TTL_MS` — bounds the
  // wait so a very late `connection.create` can't surface names for a long-past
  // transit. A jump that resolves (or drops) before the timer fires has already
  // cleared `pending` via the render-time check above, so this timer only ever
  // fires for one that's still genuinely stuck.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(
      () => {
        setPending((prev) => (prev === pending ? null : prev));
      },
      Math.max(0, pending.at + BUFFER_TTL_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pending]);

  return { transit, onTraversal };
}

/**
 * Subscribes `useBookmarkTransit`'s handler to pilot jumps. Renders nothing;
 * exists so the subscription sits inside `MapPresenceProvider` while the state
 * it feeds lives in the always-mounted owner above it.
 */
export function BookmarkTransitBridge({
  onTraversal,
}: {
  onTraversal: (t: Traversal) => void;
}) {
  useTraversals(onTraversal);
  return null;
}
