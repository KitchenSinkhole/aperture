'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Link as LinkIcon, Plus, RefreshCw } from 'lucide-react';
import { Card, CardAction, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { systemClassColor } from '@/components/map/styling';
import { fetchTheraConnections, syncTheraConnectionsOnServer } from '@/lib/map/client';
import type { MapViewData } from '@/lib/map/loadMap';
import type { MapConnectionEdge, MapEventPayload, MapSystemNode, TheraConnection, TheraSyncInput } from '@/types';
import { subscribeExperimentalPanelAdd } from '@/lib/experimentalPanelActionBus';
import { pickPrimaryChainExit } from '@/lib/map/experimentalRouteExit';

type TheraSortMode = 'name' | 'exit-jumps' | 'dest-jumps';

function hopsOnMap(
  from: MapSystemNode,
  targetEveId: number,
  systems: MapSystemNode[],
  connections: MapConnectionEdge[],
): number | null {
  const byId = new Map(systems.map((s) => [s.id, s]));
  if (!byId.has(from.id)) return null;
  const target = systems.find((s) => s.systemId === targetEveId);
  if (!target) return null;
  const adj = new Map<string, string[]>();
  for (const c of connections) {
    const a = adj.get(c.source) ?? [];
    a.push(c.target);
    adj.set(c.source, a);
    const b = adj.get(c.target) ?? [];
    b.push(c.source);
    adj.set(c.target, b);
  }
  const q: { id: string; d: number }[] = [{ id: from.id, d: 0 }];
  const seen = new Set<string>([from.id]);
  while (q.length > 0) {
    const { id, d } = q.shift()!;
    if (id === target.id) return d;
    for (const n of adj.get(id) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      q.push({ id: n, d: d + 1 });
    }
  }
  return null;
}

// Global Thera module. Lists EVE-Scout's published Thera + Turnur
// connections and folds chosen ones onto the open map. Unlike the system-scoped
// sidebar modules this is always-on (not gated on a selected system) — Thera
// connections are global scope. Per-row sync status is computed
// client-side from live `viewData`, so it re-derives for free as systems/edges
// arrive (own sync or a peer's realtime echo).

type Status = 'idle' | 'loading' | 'error';

/** A `TheraConnection` annotated with whether its hub↔target edge is already on the map. */
type AnnotatedConnection = TheraConnection & { onMap: boolean };

function toSyncInput(c: TheraConnection): TheraSyncInput {
  return {
    hubSystemId: c.hubSystemId,
    hubName: c.hubName,
    targetSystemId: c.targetSystemId,
    signatureId: c.signatureId,
  };
}

export function TheraModule({
  mapId,
  viewData,
  onBulkPaste,
}: {
  mapId: string;
  viewData: MapViewData;
  onBulkPaste: (payloads: MapEventPayload[]) => void;
}) {
  const [connections, setConnections] = useState<TheraConnection[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [sortMode, setSortMode] = useState<TheraSortMode>('name');

  useEffect(() => {
    let active = true;

    async function load() {
      setStatus('loading');
      setError(null);
      const result = await fetchTheraConnections({ mapId });
      if (!active) return;
      if (result.ok) {
        setConnections(result.data);
        setStatus('idle');
      } else {
        setConnections([]);
        setError(result.error);
        setStatus('error');
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [mapId, reload]);

  // Resolve each EVE-Scout row's on-map status against live view state: the
  // hub and target must both be placed and a connection must link them.
  const annotated = useMemo<AnnotatedConnection[]>(() => {
    const mapSystemByEveId = new Map<number, string>();
    for (const s of viewData.systems) mapSystemByEveId.set(s.systemId, s.id);
    const edgeKeys = new Set<string>();
    for (const c of viewData.connections) edgeKeys.add([c.source, c.target].sort().join('|'));

    return connections.map((c) => {
      const hubMapId = mapSystemByEveId.get(c.hubSystemId);
      const targetMapId = mapSystemByEveId.get(c.targetSystemId);
      const onMap =
        hubMapId != null &&
        targetMapId != null &&
        edgeKeys.has([hubMapId, targetMapId].sort().join('|'));
      return { ...c, onMap };
    });
  }, [connections, viewData.systems, viewData.connections]);

  const sortRows = useCallback(
    (rows: AnnotatedConnection[]) => {
      if (sortMode === 'name') {
        return [...rows].sort((a, b) => a.targetName.localeCompare(b.targetName));
      }
      const exit =
        (viewData.map.homeMapSystemId
          ? viewData.systems.find((s) => s.id === viewData.map.homeMapSystemId)
          : null) ?? pickPrimaryChainExit(viewData.systems, viewData.connections);
      const dest =
        viewData.systems.find((s) => s.status === 'hostile') ??
        viewData.systems.find((s) => /fight/i.test(s.tag ?? s.alias ?? ''));
      const score = (row: AnnotatedConnection) => {
        const anchor = sortMode === 'exit-jumps' ? exit : dest;
        if (!anchor) return 999;
        return hopsOnMap(anchor, row.targetSystemId, viewData.systems, viewData.connections) ?? 999;
      };
      return [...rows].sort((a, b) => score(a) - score(b) || a.targetName.localeCompare(b.targetName));
    },
    [sortMode, viewData],
  );

  const groups = useMemo(() => {
    const thera = annotated.filter((c) => c.hub === 'Thera');
    const turnur = annotated.filter((c) => c.hub === 'Turnur');
    return [
      { hub: 'Thera' as const, rows: sortRows(thera) },
      { hub: 'Turnur' as const, rows: sortRows(turnur) },
    ].filter((g) => g.rows.length > 0);
  }, [annotated, sortRows]);

  const missing = useMemo(() => annotated.filter((c) => !c.onMap), [annotated]);

  const sync = useCallback(
    async (rows: TheraConnection[]) => {
      if (rows.length === 0) return;
      setSyncing(true);
      try {
        const result = await syncTheraConnectionsOnServer({
          mapId,
          connections: rows.map(toSyncInput),
        });
        if (result.ok) onBulkPaste(result.data.payloads);
      } finally {
        setSyncing(false);
      }
    },
    [mapId, onBulkPaste],
  );

  useEffect(
    () =>
      subscribeExperimentalPanelAdd('thera', () => {
        void sync(missing);
      }),
    [sync, missing],
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardAction className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle Thera sort"
            title={
              sortMode === 'name'
                ? 'Sort: name'
                : sortMode === 'exit-jumps'
                  ? 'Sort: jumps from exit'
                  : 'Sort: jumps toward fight/dest'
            }
            onClick={() =>
              setSortMode((m) =>
                m === 'name' ? 'exit-jumps' : m === 'exit-jumps' ? 'dest-jumps' : 'name',
              )
            }
          >
            <ArrowDownUp className="size-3.5" />
          </Button>
          {/* <Button
            variant="ghost"
            size="sm"
            disabled={syncing || missing.length === 0}
            onClick={() => void sync(missing)}
          >
            Sync all
          </Button> */}
          <Button
            nativeButton={false}
            render={
              <a
                href="https://www.eve-scout.com/"
                target="_blank"
                rel="noreferrer"
              />
            }
            variant="ghost"
            size="icon-sm"
            aria-label="Open EVE-Scout"
          >
            <LinkIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh Eve-Scout connections"
            disabled={status === 'loading'}
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw className={status === 'loading' ? 'animate-spin' : undefined} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-xs">
        {status === 'error' ? (
          <p className="text-destructive">{error}</p>
        ) : annotated.length === 0 ? (
          <p className="text-muted-foreground">
            {status === 'loading' ? 'Loading…' : 'No active connections.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <div key={group.hub} className="flex flex-col gap-1">
                <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.hub}
                </div>
                <ul className="flex flex-col gap-1">
                  {group.rows.map((row) => (
                    <li
                      key={`${row.hubSystemId}-${row.targetSystemId}-${row.signatureId ?? ''}`}
                      className="flex items-center gap-1"
                    >
                      <span
                        aria-hidden
                        title={row.onMap ? 'On map' : 'Not on map'}
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.onMap ? '#22c55e' : '#f59e0b' }}
                      />
                      <span className="min-w-0 flex-1 truncate">{row.targetName}</span>
                      <span
                        className="shrink-0 font-mono"
                        style={{ color: systemClassColor(row.securityClass) }}
                      >
                        {row.securityClass ?? '—'}
                      </span>
                      {row.onMap ? (
                        <span className="w-6 shrink-0 text-center text-muted-foreground">✓</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Add ${row.targetName} to map`}
                          disabled={syncing}
                          onClick={() => void sync([row])}
                          title="One-click add hole"
                        >
                          <Plus />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
