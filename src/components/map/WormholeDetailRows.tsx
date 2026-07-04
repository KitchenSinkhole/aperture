'use client';

import type { WhJumpMass } from '@/lib/map/enumLabels';
import type { WormholeJumpInfoRow } from '@/types';
import { formatWormholeLifetime, formatWormholeMass } from '@/lib/eve/wormholeFormat';
import { systemClassColor } from './styling';

// Shared popup body for a wormhole's static routing data: a header line (code /
// size / leads-to class) and the Total mass / Max jump / Max lifetime rows. The
// connection and static detail popovers both render this; the connection variant
// appends its own mass-logged and EOL rows below.
export function WormholeReferenceRows({
  code,
  sizeClass,
  reference,
}: {
  code: string | null;
  sizeClass: WhJumpMass | null;
  reference: WormholeJumpInfoRow | null;
}) {
  const size = sizeClass ? sizeClass.toUpperCase() : null;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border/60 pb-1.5 font-semibold">
        <span className="font-mono">{code ?? 'unknown'}</span>
        {size && <span className="text-muted-foreground">{size}</span>}
        {reference?.targetClass && (
          <span style={{ color: systemClassColor(reference.targetClass) }}>
            {reference.targetClass}
          </span>
        )}
      </div>
      {reference && (
        <>
          <Row label="Total mass" value={formatWormholeMass(reference.totalMass)} />
          <Row label="Max jump" value={formatWormholeMass(reference.jumpMass)} />
          <Row label="Max lifetime" value={formatWormholeLifetime(reference.lifetimeMinutes)} />
        </>
      )}
    </>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
