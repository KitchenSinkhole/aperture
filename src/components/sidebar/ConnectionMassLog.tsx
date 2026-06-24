'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionMassLogEntry, MapConnectionEdge } from '@/types';
import { fetchConnectionMassLog } from '@/lib/map/client';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { connectionMassLogLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { formatAgoFromMs } from '@/lib/map/relativeTime';

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

  // Lazy fetch on mount. setState happens only after the await (so it doesn't
  // trigger the synchronous-setState-in-effect cascade).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchConnectionMassLog({ mapId, connectionId });
      if (cancelled) return;
      setEntries(result.ok ? result.data : []);
      setFailed(!result.ok);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mapId, connectionId]);

  // Refetch when a peer logs a jump on this connection. A monotonic request
  // sequence makes the latest refetch win, so a burst of jump events can't land
  // an older response after a newer one.
  const reqSeq = useRef(0);
  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'connectionMassLog') return;
        const parsed = connectionMassLogLoadSchema.safeParse(envelope.load);
        if (!parsed.success || parsed.data.connectionId !== connectionId) return;
        const seq = ++reqSeq.current;
        void (async () => {
          const result = await fetchConnectionMassLog({ mapId, connectionId });
          if (!result.ok || seq !== reqSeq.current) return;
          setEntries(result.data);
        })();
      },
      [mapId, connectionId],
    ),
  );

  const cumulative = entries.length > 0 ? entries[0]!.cumulativeMass : 0;

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Mass log</span>
        {connection.jumpMassClass ? (
          <span className="text-[10px] text-muted-foreground">
            max/jump {connection.jumpMassClass.toUpperCase()}
          </span>
        ) : null}
      </div>

      {loading ? (
        <span className="text-[10px] text-muted-foreground">Loading…</span>
      ) : failed ? (
        <span className="text-[10px] text-destructive">Couldn’t load the mass log.</span>
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
                  <span className="font-medium text-foreground">{fmtMass(e.mass)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-border/60 pt-1">
            <span className="text-[10px] text-muted-foreground">Cumulative</span>
            <span className="font-semibold tabular-nums text-foreground">{fmtMass(cumulative)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Wormhole masses are kilograms; the community unit is kilotonnes (1 kt = 1e6 kg). */
function fmtMass(kg: number): string {
  return `${new Intl.NumberFormat('en-US').format(Math.round(kg / 1e6))} kt`;
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  return formatAgoFromMs(ms);
}
