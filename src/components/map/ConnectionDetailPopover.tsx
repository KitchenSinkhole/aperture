'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import type { MapConnectionEdge } from '@/lib/map/loadMap';
import type { WormholeJumpInfoRow } from '@/types';
import { fetchWormholeJumpInfo } from '@/lib/reference/client';
import { fetchConnectionMassLog } from '@/lib/map/client';
import { connectionTimeLeftMs } from '@/lib/map/connectionState';
import { formatWormholeMass } from '@/lib/eve/wormholeFormat';
import { Row, WormholeReferenceRows } from './WormholeDetailRows';

const EOL_COUNTDOWN_TICK_MS = 30_000;

// Hover popover anchored to a connection's on-edge badge cluster. Surfaces the
// source wormhole's static routing data (type / leads-to / masses / lifetime),
// the cumulative mass logged across tracked jumps, and — for an EOL-flagged
// hole — a live countdown to nominal expiry. The mass-log is refetched on every
// open so it can't go stale after new jumps; the static reference is fetched
// once per known wormhole type (the catalog is session-cached), so it also
// populates if a WH signature is attached after the first hover. When the
// source wormhole type is unknown (no resolved WH signature attached) the
// static rows are omitted and only the size, logged mass, and countdown remain.
export function ConnectionDetailPopover({
  connection,
  mapId,
  wormholeTypeId,
  wormholeCode,
  children,
}: {
  connection: MapConnectionEdge;
  mapId: string;
  wormholeTypeId: number | null;
  wormholeCode: string | null;
  children: ReactNode;
}) {
  const [reference, setReference] = useState<WormholeJumpInfoRow | null>(null);
  const [massLogged, setMassLogged] = useState<number | null>(null);

  const load = () => {
    // Reference is keyed on the wormhole type: fetch when we don't yet hold the
    // row for the current type, which also covers a WH sig attached after the
    // first hover (wormholeTypeId flips null → known).
    if (wormholeTypeId !== null && reference?.typeId !== wormholeTypeId) {
      void fetchWormholeJumpInfo().then((result) => {
        if (result.ok) setReference(result.data.find((r) => r.typeId === wormholeTypeId) ?? null);
      });
    }
    // Refetch every open so the cumulative can't lag behind newly logged jumps.
    void fetchConnectionMassLog({ mapId, connectionId: connection.id }).then((result) => {
      setMassLogged(result.ok && result.data.length > 0 ? result.data[0]!.cumulativeMass : 0);
    });
  };

  return (
    <Tooltip.Root onOpenChange={(open) => open && load()}>
      <Tooltip.Trigger
        render={<div />}
        className="nodrag nopan pointer-events-auto flex items-center gap-1 rounded bg-card/90 px-1.5 py-0.5 text-[11px] font-semibold leading-none ring-1 ring-foreground/10"
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} side="top" align="center">
          <Tooltip.Popup className="nodrag nopan z-50 flex min-w-[190px] flex-col gap-1 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md">
            <DetailRows
              connection={connection}
              wormholeCode={wormholeCode}
              reference={reference}
              massLogged={massLogged}
            />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function DetailRows({
  connection,
  wormholeCode,
  reference,
  massLogged,
}: {
  connection: MapConnectionEdge;
  wormholeCode: string | null;
  reference: WormholeJumpInfoRow | null;
  massLogged: number | null;
}) {
  const totalMass = reference?.totalMass ?? null;
  const pct = massLogged !== null && totalMass ? Math.round((massLogged / totalMass) * 100) : null;
  const massLoggedText =
    massLogged === null
      ? '…'
      : pct !== null
        ? `${formatWormholeMass(massLogged)} (${pct}%)`
        : formatWormholeMass(massLogged);

  return (
    <>
      <WormholeReferenceRows
        code={wormholeCode}
        sizeClass={connection.jumpMassClass}
        reference={reference}
      />
      <Row label="Mass logged" value={massLoggedText} />
      {connection.eolStage !== 'none' && <EolCountdownRow connection={connection} />}
    </>
  );
}

function EolCountdownRow({ connection }: { connection: MapConnectionEdge }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), EOL_COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const ms = connectionTimeLeftMs(connection, now);
  if (ms === null) return null;
  const label = connection.eolStage === 'critical' ? 'EOL 1h' : 'EOL 4h';
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return (
    <div className="mt-0.5 flex items-center justify-between gap-3 border-t border-border/60 pt-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">
        {hours}
        <span className="ap-blink">:</span>
        {minutes}
      </span>
    </div>
  );
}
