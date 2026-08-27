'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMapActiveChar } from '@/components/map/MapActiveCharContext';
import { usePresenceForSystem } from '@/components/map/MapPresenceContext';
import { connectionBadges, connectionStyle, systemClassColor } from '@/components/map/styling';
import { ShipClassIcon } from '@/components/icons/ShipClassIcon';
import { ChevronDown, ChevronUp, Flag, FoldHorizontal } from 'lucide-react';
import {
  fitOverlayColumns,
  MAX_OVERLAY_COLUMN_PX,
  MIN_OVERLAY_COLUMN_PX,
  type OverlayColumnSizes,
} from '@/lib/map/overlayColumnFit';
import {
  DEFAULT_OVERLAY_COLUMN_WIDTHS,
  readOverlayColumnWidths,
  writeOverlayColumnWidths,
  type OverlayColumnWidths,
} from '@/lib/map/overlayColumnPrefs';
import { connectionExpiredSinceMs, connectionTimeLeftMs } from '@/lib/map/connectionState';
import { formatAgoFromMs, formatRelativeFromMs } from '@/lib/map/relativeTime';
import { pingSystemOnServer, updateSystemOnServer } from '@/lib/map/client';
import { RALLY_UNDERGLOW, UNDERGLOW_PRESETS } from '@/components/map/underglowPresets';
import { cn } from '@/lib/utils';
import type {
  MapConnectionEdge,
  MapPresenceEntry,
  MapSystemNode,
  MapViewData,
  OverlayFitOverflow,
} from '@/types';
import { Button } from '../ui/button';

// Re-tick the EOL countdown on the same cadence as the canvas edge label.
const EOL_TICK_MS = 30_000;

// The unlabelled ship-class icon column, the one pilot column that never resizes.
const ICON_COLUMN_PX = 20;

/** System class label: the `C<n>`/sec rating, falling back to trueSec then `?`. */
function classLabel(security: string | null, trueSec: number | null): string {
  if (security) return security;
  if (trueSec != null) return trueSec.toFixed(1);
  return '?';
}

/** The pilot's *custom* hull name, or '' when un-renamed (ESI defaults it to the type). */
function customShipName(p: MapPresenceEntry): string {
  return p.shipName && p.shipName !== p.shipTypeName ? p.shipName : '';
}

type PilotSortKey = 'name' | 'ship-type' | 'ship-name';
type PilotSort = { key: PilotSortKey; dir: 'asc' | 'desc' };

function pilotSortValue(p: MapPresenceEntry, key: PilotSortKey): string {
  switch (key) {
    case 'name':
      return p.characterName;
    case 'ship-type':
      return p.shipTypeName ?? '';
    case 'ship-name':
      return customShipName(p);
  }
}

function comparePilots(a: MapPresenceEntry, b: MapPresenceEntry, sort: PilotSort): number {
  const av = pilotSortValue(a, sort.key);
  const bv = pilotSortValue(b, sort.key);
  // Blank values always sink to the bottom regardless of direction.
  if (av === '' && bv !== '') return 1;
  if (bv === '' && av !== '') return -1;
  const base = av.localeCompare(bv) || a.characterName.localeCompare(b.characterName);
  return sort.dir === 'asc' ? base : -base;
}

// Live EOL indicator for one connection, mirroring ConnectionEdge's hook. Null
// for non-decaying / non-WH connections. `eol`/`critical` count down to nominal
// expiry; the manual `expired` stage counts up ("expired 3h ago").
function useEolCountdown(c: MapConnectionEdge): string | null {
  const isEol = c.eolStage !== 'none';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isEol) return;
    const id = setInterval(() => setNow(Date.now()), EOL_TICK_MS);
    return () => clearInterval(id);
  }, [isEol]);
  if (!isEol) return null;
  if (c.eolStage === 'expired') {
    const since = connectionExpiredSinceMs(c, now);
    return since === null ? null : `expired ${formatAgoFromMs(since)}`;
  }
  const ms = connectionTimeLeftMs(c, now);
  if (ms === null) return null;
  return formatRelativeFromMs(ms);
}

function Header({
  node,
  fallback,
  mapId,
}: {
  node: MapSystemNode | null;
  fallback: MapPresenceEntry | null;
  mapId: string;
}) {
  const security = node ? node.security : (fallback?.systemSecurity ?? null);
  const trueSec = node ? node.trueSec : (fallback?.systemTrueSec ?? null);
  const name = node ? (node.alias ?? node.name) : (fallback?.systemName ?? 'Unknown system');
  const tag = node?.tag ?? null;
  const color = systemClassColor(security);
  const [pinging, setPinging] = useState(false);
  const [togglingRally, setTogglingRally] = useState(false);

  async function handlePing() {
    if (!node || pinging) return;
    setPinging(true);
    await pingSystemOnServer({ mapId, mapSystemId: node.id });
    setPinging(false);
  }

  async function handleRally(e: React.MouseEvent) {
    if (!node || togglingRally) return;

    const isStartingRallyPoint = !node.rallyAt;
    const triggerEasterEgg = isStartingRallyPoint && e.shiftKey;
    if (triggerEasterEgg) {
      // Alaaaaarm! Alaaaarm...
      new Audio('/sounds/rally.mp3').play();
    }

    setTogglingRally(true);

    await updateSystemOnServer({
      mapId,
      mapSystemId: node.id,
      patch: { rallyAt: isStartingRallyPoint ? new Date().toISOString() : null },
    });

    setTogglingRally(false);
  }

  return (
    <div className="flex items-center gap-2 border-b border-foreground/10 pb-1.5">
      <span className="font-mono text-xl font-bold leading-none" style={{ color }}>
        {classLabel(security, trueSec)}
      </span>
      {tag && (
        <span className="font-mono text-xl font-bold leading-none" style={{ color }}>
          {tag}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{name}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          className="h-6 px-1.5 text-[10px]"
          size="sm"
          disabled={!node || pinging}
          style={{ borderColor: UNDERGLOW_PRESETS.ping.color }}
          onClick={() => void handlePing()}
        >
          Ping
        </Button>
        <Button
          variant="outline"
          className="h-6 px-1.5 text-[10px]"
          size="sm"
          disabled={!node || togglingRally}
          style={{ borderColor: RALLY_UNDERGLOW.color }}
          onClick={(e) => void handleRally(e)}
        >
          <Flag className="size-3" /> Rally
        </Button>
      </div>
    </div>
  );
}

const COLS: {
  key: PilotSortKey;
  label: string;
  columnSpan?: number;
  resize?: keyof OverlayColumnWidths;
}[] = [
  { key: 'name', label: 'Pilot', resize: 'pilot' },
  { key: 'ship-name', label: 'Name', resize: 'name' },
  { key: 'ship-type', label: 'Type', columnSpan: 2 },
];

/**
 * Natural width of each pilot column, measured off a hidden auto-layout clone of
 * the live table so the real one never flickers out of its fixed layout. The
 * clone keeps the original's classes and so resolves against the same
 * stylesheets, including inside the PiP document.
 */
function measureNaturalWidths(
  table: HTMLTableElement,
): { content: OverlayColumnSizes; fixed: number } | null {
  const probe = table.cloneNode(true) as HTMLTableElement;
  probe.querySelector('colgroup')?.remove();
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;visibility:hidden;width:max-content;table-layout:auto';
  table.ownerDocument.body.appendChild(probe);
  try {
    const cells = probe.tBodies[0]?.rows[0]?.cells;
    if (!cells || cells.length < 4) return null;
    const widthOf = (index: number) => cells[index]!.getBoundingClientRect().width;
    return {
      content: { pilot: widthOf(0), name: widthOf(1), type: widthOf(3) },
      fixed: widthOf(2),
    };
  } finally {
    probe.remove();
  }
}

/**
 * Widen the Document PiP window `node` lives in by `growBy` px. A no-op when the
 * overlay is not in a PiP window; `resizeTo` needs a user activation, which the
 * click that reached here supplies.
 */
function growOverlayWindow(node: HTMLElement, growBy: number): void {
  const win = node.ownerDocument.defaultView;
  if (!win || win === window) return;
  try {
    win.resizeTo(Math.round(win.outerWidth + growBy), win.outerHeight);
  } catch {
    // NotAllowedError — the click carried no activation after all.
  }
}

function Pilots({
  others,
  fitOverflow,
}: {
  others: readonly MapPresenceEntry[];
  fitOverflow: OverlayFitOverflow;
}) {
  const [sort, setSort] = useState<PilotSort>({ key: 'ship-type', dir: 'asc' });
  const [widths, setWidths] = useState<OverlayColumnWidths>(
    () => readOverlayColumnWidths() ?? DEFAULT_OVERLAY_COLUMN_WIDTHS,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const onSort = (key: PilotSortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );

  const sorted = useMemo(
    () => [...others].sort((a, b) => comparePilots(a, b, sort)),
    [others, sort],
  );

  function startResize(key: keyof OverlayColumnWidths, e: React.PointerEvent<HTMLElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startWidth = widths[key];
    const other = key === 'pilot' ? widths.name : widths.pilot;
    const available = wrapRef.current?.clientWidth ?? 0;
    // Leave the icon column and a floor-width trailing column their room.
    const max =
      available > 0
        ? Math.max(
            MIN_OVERLAY_COLUMN_PX,
            available - ICON_COLUMN_PX - other - MIN_OVERLAY_COLUMN_PX,
          )
        : MAX_OVERLAY_COLUMN_PX;

    let next = startWidth;
    const onMove = (ev: PointerEvent) => {
      next = Math.round(
        Math.min(Math.max(startWidth + ev.clientX - startX, MIN_OVERLAY_COLUMN_PX), max),
      );
      setWidths((w) => ({ ...w, [key]: next }));
    };
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      writeOverlayColumnWidths({ ...widths, [key]: next });
    };
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  }

  function fitToContent() {
    const table = tableRef.current;
    const wrap = wrapRef.current;
    if (!table || !wrap) return;
    const measured = measureNaturalWidths(table);
    if (!measured) return;

    const { widths: fitted, growBy } = fitOverlayColumns({
      ...measured,
      available: wrap.clientWidth,
      policy: fitOverflow,
    });
    const applied = { pilot: Math.round(fitted.pilot), name: Math.round(fitted.name) };
    setWidths(applied);
    writeOverlayColumnWidths(applied);
    if (growBy > 0) growOverlayWindow(wrap, growBy);
  }

  if (others.length === 0) {
    return <div className="text-[11px] italic text-muted-foreground">Alone in system</div>;
  }

  return (
    <div ref={wrapRef} className="w-full overflow-hidden">
      <table ref={tableRef} className="w-full table-fixed text-xs">
        <colgroup>
          <col style={{ width: widths.pilot }} />
          <col style={{ width: widths.name }} />
          <col style={{ width: ICON_COLUMN_PX }} />
          <col />
        </colgroup>
        <thead className="text-[10px] uppercase text-muted-foreground">
          <tr>
            {COLS.map(({ key, label, columnSpan, resize }) => {
              const active = sort.key === key;
              return (
                <th key={key} colSpan={columnSpan} className="relative pb-1 text-left font-medium">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSort(key)}
                      className="flex min-w-0 flex-1 items-center gap-1 transition-colors hover:text-foreground"
                    >
                      <span className="truncate">{label}</span>
                      {active &&
                        (sort.dir === 'asc' ? (
                          <ChevronUp className="size-3 shrink-0" aria-hidden />
                        ) : (
                          <ChevronDown className="size-3 shrink-0" aria-hidden />
                        ))}
                    </button>
                    {!resize && (
                      <button
                        type="button"
                        title="Fit columns to content"
                        aria-label="Fit columns to content"
                        onClick={fitToContent}
                        className="shrink-0 transition-colors hover:text-foreground"
                      >
                        <FoldHorizontal className="size-3" aria-hidden />
                      </button>
                    )}
                  </div>
                  {resize && (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${label} column`}
                      title="Drag to resize"
                      onPointerDown={(e) => startResize(resize, e)}
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none"
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.characterId} className="border-t border-foreground/10">
              <td className="truncate py-0.5 pr-1 text-muted-foreground">{p.characterName}</td>
              <td className="truncate py-0.5 pr-1">{customShipName(p) || '—'}</td>
              <td className="py-0.5 pr-1">
                <ShipClassIcon shipClass={p.shipClass} />
              </td>
              <td className="truncate py-0.5 text-emerald-400">{p.shipTypeName ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectionRow({
  edge,
  far,
  sig,
}: {
  edge: MapConnectionEdge;
  far: MapSystemNode | null;
  sig: string | null;
}) {
  const countdown = useEolCountdown(edge);
  const dotColor = connectionStyle(edge).stroke;
  const color = systemClassColor(far?.security);
  // connectionBadges already carries an EOL badge; drop it so the live countdown
  // is the single EOL indicator, keeping STATIC / size.
  const badges = connectionBadges(edge).filter((b) => b.key !== 'eol');
  return (
    <li className="flex items-center gap-1.5 text-xs">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
        aria-hidden
      />
      {sig && <span className="font-mono text-muted-foreground">{sig.slice(0, 3)}</span>}
      <span className="font-mono font-bold" style={{ color }}>
        {far ? classLabel(far.security, far.trueSec) : '?'}
      </span>
      {far?.tag && (
        <span className="font-mono font-bold" style={{ color }}>
          {far.tag}
        </span>
      )}
      <span className="truncate">{far ? (far.alias ?? far.name) : 'Unknown'}</span>
      {badges.map((b) => (
        <span
          key={b.key}
          className={cn(
            'rounded px-1 text-[9px] font-semibold uppercase',
            b.tone === 'danger'
              ? 'bg-red-500/20 text-red-500'
              : b.tone === 'warn'
                ? 'bg-amber-500/20 text-amber-500'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {b.label}
        </span>
      ))}
      {countdown && <span className="text-[10px] font-semibold text-amber-500">{countdown}</span>}
    </li>
  );
}

function Connections({ node, viewData }: { node: MapSystemNode; viewData: MapViewData }) {
  const nodeById = new Map(viewData.systems.map((s) => [s.id, s]));
  const edges = viewData.connections.filter(
    (c) => (c.source === node.id || c.target === node.id) && c.scope !== 'abyssal',
  );
  // The in-system scan id (3-char `sigId`) of the sig that resolves to each
  // connection — the sig as seen on *this* system's scanner, not the far side.
  const sigByConn = new Map<string, string>();
  for (const s of viewData.signatures) {
    if (s.mapSystemId === node.id && s.mapConnectionId) sigByConn.set(s.mapConnectionId, s.sigId);
  }
  if (edges.length === 0) {
    return (
      <div className="border-t border-foreground/10 pt-2 text-[11px] italic text-muted-foreground">
        No connections
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 border-t border-foreground/10 pt-2">
      {edges.map((edge) => {
        const farId = edge.source === node.id ? edge.target : edge.source;
        return (
          <ConnectionRow
            key={edge.id}
            edge={edge}
            far={nodeById.get(farId) ?? null}
            sig={sigByConn.get(edge.id) ?? null}
          />
        );
      })}
    </ul>
  );
}

/**
 * Read-only floating-overlay panel: the active character's current system
 * (class + tag prominent, name secondary), the other pilots in that system and
 * their ships, and the non-abyssal connections out with mass/EOL state. Renders
 * the live `viewData` + presence store + active-character context the map page
 * already maintains, so it stays in sync with no extra data wiring. Must render
 * (via a PiP portal) inside `MapPresenceProvider` + `MapActiveCharProvider`.
 */
export function SystemOverlay({
  viewData,
  fitOverflow,
}: {
  viewData: MapViewData;
  fitOverflow: OverlayFitOverflow;
}) {
  const { activeCharId, activeCharSystemId } = useMapActiveChar();
  const roster = usePresenceForSystem(activeCharSystemId ?? -1);

  if (activeCharSystemId == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center text-sm text-muted-foreground">
        No tracked character located
      </div>
    );
  }

  const node = viewData.systems.find((s) => s.systemId === activeCharSystemId) ?? null;
  const others = roster.filter((p) => p.characterId !== activeCharId);
  // Any roster entry resolves the system's class/name when the active char's
  // system isn't placed on the chain (off-map fallback header).
  const fallback = roster.find((p) => p.characterId === activeCharId) ?? roster[0] ?? null;

  return (
    <div className="flex flex-col gap-2 p-2 text-sm">
      <Header node={node} fallback={fallback} mapId={viewData.map.id} />
      <Pilots others={others} fitOverflow={fitOverflow} />
      {node && <Connections node={node} viewData={viewData} />}
    </div>
  );
}
