'use client';

import { useMemo } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { EmptyRow, InfoTable, ScrollTable, Td, Th } from '@/components/dialogs/infoTable';
import { usePresenceForMap } from '@/components/map/MapPresenceContext';
import type { MapConnectionEdge, MapSystemNode, MapViewData } from '@/types';

/**
 * Map Info dialog — a four-tab live snapshot of the open map.
 * Reads entirely from the canvas's `viewData` (kept current by realtime
 * `mapUpdate` apply) and the presence store; no server call. Triggered from the
 * `MapCanvas` toolbar so it always sees the live map.
 */
export function MapInfoDialog({
  open,
  onOpenChange,
  viewData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewData: MapViewData;
}) {
  const presence = usePresenceForMap();
  // ap_map_system id → node, for resolving connection endpoints to system names.
  const systemById = useMemo(() => {
    const m = new Map<string, MapSystemNode>();
    for (const s of viewData.systems) m.set(s.id, s);
    return m;
  }, [viewData.systems]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{viewData.map.name}</DialogTitle>
          <DialogDescription className="capitalize">
            {viewData.map.type} · {viewData.map.scope}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTab value="summary">Summary</TabsTab>
            <TabsTab value="systems">Systems ({viewData.systems.length})</TabsTab>
            <TabsTab value="connections">Connections ({viewData.connections.length})</TabsTab>
          </TabsList>

          <TabsPanel value="summary">
            <SummaryPanel viewData={viewData} pilotCount={presence.length} />
          </TabsPanel>
          <TabsPanel value="systems">
            <SystemsPanel systems={viewData.systems} />
          </TabsPanel>
          <TabsPanel value="connections">
            <ConnectionsPanel connections={viewData.connections} systemById={systemById} />
          </TabsPanel>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SummaryPanel({ viewData, pilotCount }: { viewData: MapViewData; pilotCount: number }) {
  const shareLink =
    typeof window === 'undefined'
      ? `/map/${viewData.map.id}`
      : `${window.location.origin}/map/${viewData.map.id}`;

  const copy = () => {
    void navigator.clipboard.writeText(shareLink).then(
      () => toast.success('Map link copied'),
      () => toast.error('Could not copy link'),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        <CountTile label="Systems" value={viewData.systems.length} />
        <CountTile label="Connections" value={viewData.connections.length} />
        <CountTile label="Online pilots" value={pilotCount} />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase text-muted-foreground">Share link</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted/60 px-2 py-1.5 text-xs">
            {shareLink}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy />
            Copy
          </Button>
        </div>
      </div>
    </div>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md ring-1 ring-foreground/10 px-3 py-2">
      <span className="font-mono text-xl tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function SystemsPanel({ systems }: { systems: MapSystemNode[] }) {
  const sorted = useMemo(
    () => [...systems].sort((a, b) => a.name.localeCompare(b.name)),
    [systems],
  );

  if (sorted.length === 0) return <EmptyRow>No systems on this map.</EmptyRow>;

  return (
    <ScrollTable>
      <InfoTable>
        <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase text-muted-foreground">
          <tr>
            <Th>System</Th>
            <Th>Region / Constellation</Th>
            <Th className="text-right">Sec</Th>
            <Th>Status</Th>
            <Th>Statics</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.id} className="border-t border-foreground/10">
              <Td>
                {s.name}
                {s.alias ? <span className="text-muted-foreground"> ({s.alias})</span> : null}
              </Td>
              <Td className="text-muted-foreground">
                {s.regionName} / {s.constellationName}
              </Td>
              <Td className="text-right font-mono tabular-nums">{s.security ?? '—'}</Td>
              <Td className="capitalize">{s.status}</Td>
              <Td className="font-mono">{s.statics.length ? s.statics.join(', ') : '—'}</Td>
            </tr>
          ))}
        </tbody>
      </InfoTable>
    </ScrollTable>
  );
}

function ConnectionsPanel({
  connections,
  systemById,
}: {
  connections: MapConnectionEdge[];
  systemById: Map<string, MapSystemNode>;
}) {
  if (connections.length === 0) return <EmptyRow>No connections on this map.</EmptyRow>;

  const label = (id: string) => systemById.get(id)?.name ?? id;

  return (
    <ScrollTable>
      <InfoTable>
        <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase text-muted-foreground">
          <tr>
            <Th>Connection</Th>
            <Th>Scope</Th>
            <Th>Mass</Th>
            <Th>Size</Th>
            <Th>EOL</Th>
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => (
            <tr key={c.id} className="border-t border-foreground/10">
              <Td>
                {label(c.source)} <span className="text-muted-foreground">→</span> {label(c.target)}
              </Td>
              <Td className="capitalize">{c.scope}</Td>
              <Td className="capitalize">{c.massStatus}</Td>
              <Td className="uppercase">{c.jumpMassClass ?? '—'}</Td>
              <Td
                className={
                  c.eolStage === 'critical'
                    ? 'font-medium text-destructive'
                    : c.eolStage === 'eol'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }
              >
                {c.eolStage === 'critical' ? 'EOL 1h' : c.eolStage === 'eol' ? 'EOL' : '—'}
              </Td>
            </tr>
          ))}
        </tbody>
      </InfoTable>
    </ScrollTable>
  );
}
