'use client';

import { Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import type { MapSystemNode } from '@/lib/map/loadMap';
import type { SystemIntelSummary } from '@/lib/map/intel';
import { systemEffectName, type SystemEffectKey } from '@/lib/eve/systemEffects';
import { systemClassColor, systemEffectColor, trueSecColor } from '@/components/map/styling';

export function IntelModule({
  system,
  intel,
}: {
  system: MapSystemNode | null;
  intel: SystemIntelSummary | undefined;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3 text-xs">
        {!system ? (
          <p className="text-muted-foreground">Select a system to see intel.</p>
        ) : (
          <>
            <SystemMeta system={system} />
            <SovereigntyBlock intel={intel} />
            <FactionWarBlock intel={intel} />
            <IncursionBlock intel={intel} />
            <ScoutBlock intel={intel} />
            {intel ? <ExternalLinks links={intel.links} /> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const copy = () => {
    void navigator.clipboard.writeText(value).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Could not copy ${label.toLowerCase()}`),
    );
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label.toLowerCase()}`}
      className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
    >
      <Copy className="size-3" />
    </button>
  );
}

function SystemMeta({ system }: { system: MapSystemNode }) {
  return (
    <dl className="grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1">
      <dt className="text-muted-foreground">System</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className="truncate">{system.name}</span>
        <CopyValue value={system.name} label="System name" />
        <span className="ml-2 shrink-0 font-mono text-muted-foreground">{system.systemId}</span>
        <CopyValue value={String(system.systemId)} label="System ID" />
      </dd>
      <dt className="text-muted-foreground">Region</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className="truncate">{system.regionName}</span>
        <CopyValue value={system.regionName} label="Region" />
      </dd>
      <dt className="text-muted-foreground">Const.</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className="truncate">{system.constellationName}</span>
        <CopyValue value={system.constellationName} label="Constellation" />
      </dd>
      <dt className="text-muted-foreground">Security</dt>
      <dd>
        <SecurityValue system={system} />
      </dd>
      {system.effect ? (
        <>
          <dt className="text-muted-foreground">Effect</dt>
          <dd className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-xs ring-1 ring-foreground/25"
              style={{ backgroundColor: systemEffectColor(system.effect as SystemEffectKey) }}
              aria-hidden
            />
            {systemEffectName(system.effect as SystemEffectKey)}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function SecurityValue({ system }: { system: MapSystemNode }) {
  if (system.trueSec != null) {
    return (
      <span className="font-mono font-semibold" style={{ color: trueSecColor(system.trueSec) }}>
        {system.trueSec.toFixed(1)}
      </span>
    );
  }
  if (system.security) {
    return (
      <span className="font-mono font-semibold" style={{ color: systemClassColor(system.security) }}>
        {system.security}
      </span>
    );
  }
  return <span className="text-muted-foreground">unknown</span>;
}

function SovereigntyBlock({ intel }: { intel: SystemIntelSummary | undefined }) {
  const sov = intel?.sovereignty;
  if (!sov) return <p className="text-muted-foreground">No sovereignty data.</p>;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase text-muted-foreground">Sovereignty</span>
      <div className="flex items-center gap-2">
        {sov.allianceImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sov.allianceImage} alt="" className="size-6 rounded-sm" />
        ) : sov.corporationImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sov.corporationImage} alt="" className="size-6 rounded-sm" />
        ) : null}
        <span className="font-mono text-muted-foreground">{sovereigntyLabel(sov)}</span>
      </div>
    </div>
  );
}

// Alliance holds sov over corp over faction; prefer the resolved name, falling
// back to the raw id only until the name cache warms.
function sovereigntyLabel(sov: NonNullable<SystemIntelSummary['sovereignty']>): string {
  if (sov.allianceId) return sov.allianceName ?? `Alliance ${sov.allianceId}`;
  if (sov.corporationId) return sov.corporationName ?? `Corp ${sov.corporationId}`;
  if (sov.factionId) return sov.factionName ?? `Faction ${sov.factionId}`;
  return 'unclaimed';
}

function FactionWarBlock({ intel }: { intel: SystemIntelSummary | undefined }) {
  const fw = intel?.factionWar;
  if (!fw) return null;
  const victory =
    fw.victoryPoints !== null && fw.victoryPointsThreshold
      ? `${Math.round((fw.victoryPoints / fw.victoryPointsThreshold) * 100)}%`
      : null;
  const occupier = fw.occupierFactionId
    ? (fw.occupierFactionName ?? `Faction ${fw.occupierFactionId}`)
    : 'No occupier';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase text-muted-foreground">Faction Warfare</span>
      <span className="font-mono text-muted-foreground">
        {occupier}
        {fw.contested ? ` / ${fw.contested}` : ''}
        {victory ? ` / ${victory}` : ''}
      </span>
    </div>
  );
}

function IncursionBlock({ intel }: { intel: SystemIntelSummary | undefined }) {
  const inc = intel?.incursion;
  if (!inc) return null;
  const faction = inc.factionName ?? (inc.factionId ? `Faction ${inc.factionId}` : 'Unknown');
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase text-muted-foreground">Incursion</span>
      <span className="font-mono text-muted-foreground">
        {faction} / {inc.state}
        {inc.isStaging ? ' / Staging' : ''}
      </span>
      <span className="font-mono text-muted-foreground">
        Influence {Math.round(inc.influence * 100)}%{inc.hasBoss ? ' / Boss spawned' : ''}
      </span>
    </div>
  );
}

function ScoutBlock({ intel }: { intel: SystemIntelSummary | undefined }) {
  const rows = intel?.scoutConnections ?? [];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase text-muted-foreground">EVE-Scout</span>
      {rows.length === 0 ? (
        <span className="text-muted-foreground">No Thera / Turnur hits.</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.slice(0, 3).map((row, idx) => (
            <li key={`${row.sourceName}-${row.targetName}-${idx}`} className="flex justify-between gap-2">
              <span>{row.hub}</span>
              <span className="truncate text-muted-foreground">
                {row.sourceName} to {row.targetName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExternalLinks({ links }: { links: SystemIntelSummary['links'] }) {
  const items = [
    ['DOTLAN', links.dotlan],
    ['EVEEYE', links.eveeye],
    ['Anoik', links.anoik],
    ['zKill', links.zkillboard],
  ] as const;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {items.map(([label, href]) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-accent"
        >
          {label}
          <ExternalLink className="size-3" />
        </a>
      ))}
    </div>
  );
}
