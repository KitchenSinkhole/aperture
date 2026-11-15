'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionMassLogEntry, MapConnectionEdge } from '@/types';
import { fetchConnectionMassLog } from '@/lib/map/client';
import { useRealtime, useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { connectionMassLogLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { formatAgoFromMs } from '@/lib/map/relativeTime';
import { formatWormholeMass } from '@/lib/eve/wormholeFormat';

/**
 * Read-only per-jump mass-log for the selected connection. The
 * log is server-derived from the location-poll; this module only reads it and
 * refetches when a peer's jump arrives over the `connectionMassLog` realtime
 * task. No manual entry.
 *
 * Documented limitation: an exact "% to next mass status" would need the WH
 * type's total stable mass, which connections don't store — so we surface the
 * cumulative absolute plus the per-jump max-size ceiling (`jumpMassClass`) only.
 */
export function ConnectionMassLog({
  mapId,
  connection,
}: {
  mapId: string;
  connection: MapConnectionEdge;
}) {
  const connectionId = connection.id;
  // The parent remounts this module via `key={connection.id}`, so state resets
  // on connection change and the lazy fetch below runs once per connection.
  const [entries, setEntries] = useState<ConnectionMassLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Blackout withholds the log from this viewer: the server sent no entries.
  const [hidden, setHidden] = useState(false);

  // Lazy fetch on mount. setState happens only after the await (so it doesn't
  // trigger the synchronous-setState-in-effect cascade).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchConnectionMassLog({ mapId, connectionId });
      if (cancelled) return;
      setEntries(result.ok ? result.data : []);
      setHidden(result.ok && result.hidden === true);
      setFailed(!result.ok);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mapId, connectionId]);

  // A monotonic request sequence makes the latest refetch win, so a burst of
  // jump events can't land an older response after a newer one.
  const reqSeq = useRef(0);
  const refetch = useCallback(() => {
    const seq = ++reqSeq.current;
    void (async () => {
      const result = await fetchConnectionMassLog({ mapId, connectionId });
      if (!result.ok || seq !== reqSeq.current) return;
      setEntries(result.data);
      setHidden(result.hidden === true);
    })();
  }, [mapId, connectionId]);

  // A restricted viewer receives no `connectionMassLog` frames, so the Blackout
  // standing is the only cue that the log became visible (or hidden). Keyed to
  // what is shown rather than to the previous standing: the standing is null
  // until this tab's first `healthCheck`, and the flip can arrive as that first
  // value. A refetch that returns the same `hidden` leaves the deps unchanged,
  // so a persistent disagreement costs one request, not a loop.
  const { blackout } = useRealtime();
  const restricted = blackout ? blackout.active && !blackout.cleared : null;
  useEffect(() => {
    if (loading || failed || restricted === null || restricted === hidden) return;
    refetch();
  }, [loading, failed, restricted, hidden, refetch]);

  // Refetch when a peer logs a jump on this connection.
  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'connectionMassLog') return;
        const parsed = connectionMassLogLoadSchema.safeParse(envelope.load);
        if (!parsed.success || parsed.data.connectionId !== connectionId) return;
        // Belt-and-suspenders: the SharedWorker already routes map-scoped
        // envelopes only to subscribed ports; a foreign mapId here would mean
        // a worker routing regression, not a legitimate cross-map refetch.
        // Checked against the load's mapId, which the schema makes mandatory —
        // the envelope-level tag is optional, so a producer that stopped setting
        // it would leave a guard on it passing everything.
        if (parsed.data.mapId !== Number(mapId)) return;
        refetch();
      },
      [mapId, connectionId, refetch],
    ),
  );

  const cumulative = entries.length > 0 ? entries[0]!.cumulativeMass : 0;

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Mass log</span>
        {connection.jumpMassClass ? (
          <span className="text-[10px] text-muted-foreground">
            ship size {connection.jumpMassClass.toUpperCase()}
          </span>
        ) : null}
      </div>

      {loading ? (
        <span className="text-[10px] text-muted-foreground">Loading…</span>
      ) : failed ? (
        <span className="text-[10px] text-destructive">Couldn’t load the mass log.</span>
      ) : hidden ? (
        <span className="text-[10px] text-muted-foreground">
          The mass log is hidden during Blackout.
        </span>
      ) : entries.length === 0 ? (
        <span className="text-[10px] text-muted-foreground">No jumps logged yet.</span>
      ) : (
        <>
          <ul className="flex flex-col gap-0.5">
            {entries.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-2 tabular-nums">
                <span className="truncate text-foreground">
                  {e.characterName ?? 'Unknown'}
                  {e.shipTypeName ? (
                    <span className="text-muted-foreground"> · {e.shipTypeName}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-[10px] text-muted-foreground">{fmtAgo(e.jumpedAt)}</span>
                  <span className="font-medium text-foreground">{formatWormholeMass(e.mass)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-border/60 pt-1">
            <span className="text-[10px] text-muted-foreground">Cumulative</span>
            <span className="font-semibold tabular-nums text-foreground">{formatWormholeMass(cumulative)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  return formatAgoFromMs(ms);
}
