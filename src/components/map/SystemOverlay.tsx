'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMapActiveChar } from '@/components/map/MapActiveCharContext';
import { usePresenceForSystem } from '@/components/map/MapPresenceContext';
import { connectionBadges, connectionStyle, systemClassColor } from '@/components/map/styling';
import { ShipClassIcon } from '@/components/icons/ShipClassIcon';
import { ChevronDown, ChevronUp, Flag } from 'lucide-react';
import { connectionExpiredSinceMs, connectionTimeLeftMs } from '@/lib/map/connectionState';
import { formatAgoFromMs, formatRelativeFromMs } from '@/lib/map/relativeTime';
import { parseDscanPaste } from '@/lib/map/dscanParser';
import { resolveShipClass } from '@/lib/eve/shipClass';
import { fetchShipTypeGroups } from '@/lib/reference/client';
import { pingSystemOnServer, updateSystemOnServer } from '@/lib/map/client';
import { RALLY_UNDERGLOW, UNDERGLOW_PRESETS } from '@/components/map/underglowPresets';
import { cn } from '@/lib/utils';
import { Input } from '../ui/input';
import type {
  MapConnectionEdge,
  MapPresenceEntry,
  MapSystemNode,
  MapViewData,
  ParsedDscanRow,
  ShipClass,
} from '@/types';
import { Button } from '../ui/button';

// Re-tick the EOL countdown on the same cadence as the canvas edge label.
const EOL_TICK_MS = 30_000;

// How long a search result set stays on screen. The countdown bar runs off the
// same value, so it fills exactly as the rows are dropped.
const RESULT_TTL_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 200;

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

/** Shared column widths so a result row lines up with the ship list above it. */
function PilotCols() {
  return (
    <colgroup>
      <col className="w-[38%]" />
      <col className="w-[38%]" />
      <col className="w-5" />
      <col />
    </colgroup>
  );
}

/**
 * `text` with every occurrence of `needle` marked, so a hit is visible in the
 * cell that produced it. Case-insensitive, to match how the search compares.
 * Renders the text untouched when there is no needle — a D-Scan paste has none.
 */
function Highlight({ text, needle }: { text: string; needle?: string }) {
  if (!needle) return <>{text}</>;
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  for (let hit = haystack.indexOf(target); hit !== -1; hit = haystack.indexOf(target, at)) {
    if (hit > at) parts.push(text.slice(at, hit));
    parts.push(
      <mark key={hit} className="rounded-[2px] bg-amber-400/30 text-inherit">
        {text.slice(hit, hit + target.length)}
      </mark>,
    );
    at = hit + target.length;
  }
  if (parts.length === 0) return <>{text}</>;
  return (
    <>
      {parts}
      {text.slice(at)}
    </>
  );
}

function PilotCells({ p, highlight }: { p: MapPresenceEntry; highlight?: string }) {
  const shipName = customShipName(p);
  return (
    <>
      <td className="truncate py-0.5 pr-1 text-muted-foreground">
        <Highlight text={p.characterName} needle={highlight} />
      </td>
      <td className="truncate py-0.5 pr-1">
        {shipName ? <Highlight text={shipName} needle={highlight} /> : '—'}
      </td>
      <td className="py-0.5 pr-1">
        <ShipClassIcon shipClass={p.shipClass} />
      </td>
      <td className="truncate py-0.5 text-emerald-400">
        {p.shipTypeName === null ? '—' : <Highlight text={p.shipTypeName} needle={highlight} />}
      </td>
    </>
  );
}

function Pilots({ others }: { others: readonly MapPresenceEntry[] }) {
  const [sort, setSort] = useState<PilotSort>({ key: 'ship-type', dir: 'asc' });

  const onSort = (key: PilotSortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );

  const sorted = useMemo(
    () => [...others].sort((a, b) => comparePilots(a, b, sort)),
    [others, sort],
  );

  if (others.length === 0) {
    return <div className="text-[11px] italic text-muted-foreground">Alone in system</div>;
  }

  const COLS: { key: PilotSortKey; label: string; columnSpan?: number }[] = [
    { key: 'name', label: 'Pilot' },
    { key: 'ship-name', label: 'Name' },
    { key: 'ship-type', label: 'Type', columnSpan: 2 },
  ];

  return (
    <table className="w-full table-fixed text-xs">
      <PilotCols />
      <thead className="text-[10px] uppercase text-muted-foreground">
        <tr>
          {COLS.map(({ key, label, columnSpan }) => {
            const active = sort.key === key;
            return (
              <th key={key} colSpan={columnSpan} className="pb-1 text-left font-medium">
                <button
                  type="button"
                  onClick={() => onSort(key)}
                  className="flex w-full items-center gap-1 transition-colors hover:text-foreground"
                >
                  {label}
                  {active &&
                    (sort.dir === 'asc' ? (
                      <ChevronUp className="size-3" aria-hidden />
                    ) : (
                      <ChevronDown className="size-3" aria-hidden />
                    ))}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.characterId} className="border-t border-foreground/10">
            <PilotCells p={p} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type SearchResult =
  | { key: string; kind: 'pilot'; pilot: MapPresenceEntry }
  | { key: string; kind: 'unknown'; name: string; typeName: string; shipClass: ShipClass | null };

/**
 * One frozen result set. `id` keys the DOM so the countdown restarts,
 * `emptyMessage` is what the area shows in place of rows when nothing matched,
 * and `highlight` is the query to mark inside the rows — null for a D-Scan
 * paste, which matches on type id rather than on any text the row shows.
 */
type SearchOutcome = {
  id: number;
  emptyMessage: string;
  highlight: string | null;
  results: SearchResult[];
};

/**
 * The countdown above a result set: a muted-foreground line filling left to
 * right over the set's lifetime, on a faded track of the same colour. Styling
 * and keyframe live in `globals.css`; only the duration rides in on the element,
 * so it cannot drift from the constant that arms the removal timer.
 */
function ResultProgress() {
  return (
    <span className="ap-result-track" aria-hidden>
      <span className="ap-result-fill" style={{ animationDuration: `${RESULT_TTL_MS}ms` }} />
    </span>
  );
}

/**
 * The roster entry a D-Scan row names, or null when nobody in the list flies it.
 * The hull type id must match, plus either the exact ship name (a renamed hull)
 * or the pilot's name appearing inside it (the client's default `<Pilot>'s
 * <Type>` naming) — same ship, same pilot.
 */
function matchDscanRow(
  row: ParsedDscanRow,
  roster: readonly MapPresenceEntry[],
): MapPresenceEntry | null {
  const name = row.name.toLowerCase();
  const onHull = roster.filter((p) => p.shipTypeId === row.typeId);

  // ESI stores the ship's own name, which is the same string D-Scan prints, so
  // an exact match is the dependable path.
  const named = onHull.find((p) => (p.shipName ?? '').toLowerCase() === name);
  if (named) return named;

  // Otherwise fall back to the client's default `<Pilot>'s <Type>` naming,
  // anchored at the start: searching for the pilot's name anywhere in the cell
  // would let "Bob" claim "Bobby's Loki". A tie is left unresolved rather than
  // attributed to whichever pilot the roster happens to list first.
  const owners = onHull.filter((p) => name.startsWith(`${p.characterName.toLowerCase()}'s `));
  return owners.length === 1 ? (owners[0] ?? null) : null;
}

// The result area is only a couple hundred pixels wide in a PiP window, so a
// long query echoed back whole would wrap the not-found line over several rows.
const QUERY_ECHO_MAX = 40;

function echoQuery(query: string): string {
  return query.length <= QUERY_ECHO_MAX ? query : `${query.slice(0, QUERY_ECHO_MAX)}…`;
}

function searchRoster(query: string, roster: readonly MapPresenceEntry[]): MapPresenceEntry[] {
  const needle = query.toLowerCase();
  return roster.filter(
    (p) =>
      p.characterName.toLowerCase().includes(needle) ||
      (p.shipName ?? '').toLowerCase().includes(needle) ||
      (p.shipTypeName ?? '').toLowerCase().includes(needle),
  );
}

// Padding sits on the rows rather than the panel, so the countdown bar can run
// edge to edge along the top.
function ResultArea({ outcome }: { outcome: SearchOutcome }) {
  return (
    <div className="mb-2 flex flex-col gap-1 bg-muted/50 pb-1">
      <ResultProgress />
      <div className="px-1.5">
        {outcome.results.length === 0 ? (
          <div className="text-[11px] italic text-muted-foreground">{outcome.emptyMessage}</div>
        ) : (
          <table className="w-full table-fixed text-xs">
            <PilotCols />
            <tbody>
              {outcome.results.map((r) => (
                <tr key={r.key}>
                  {r.kind === 'pilot' ? (
                    <PilotCells p={r.pilot} highlight={outcome.highlight ?? undefined} />
                  ) : (
                    <>
                      <td className="truncate py-0.5 pr-1 text-red-400">Unknown pilot</td>
                      <td className="truncate py-0.5 pr-1 text-red-400">{r.name}</td>
                      <td className="py-0.5 pr-1">
                        {r.shipClass && <ShipClassIcon shipClass={r.shipClass} />}
                      </td>
                      <td className="truncate py-0.5 text-red-400">{r.typeName}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * Search box over the ship list plus the transient result area beneath it.
 * Pasting D-Scan text resolves each line against the list; anything else is a
 * substring search over pilot / ship name / hull type. Results are a frozen
 * snapshot that self-clears after `RESULT_TTL_MS`.
 */
function PilotSearch({ others }: { others: readonly MapPresenceEntry[] }) {
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  // Read at search time only: a result set is a snapshot, so live presence
  // churn must not re-run the search and restart its countdown.
  const rosterRef = useRef(others);
  useEffect(() => {
    rosterRef.current = others;
  }, [others]);
  const nextId = useRef(0);

  // Held so a paste can cancel a search the user had already half-typed: the
  // paste awaits the ship-type catalog, and a debounce firing inside that gap
  // would put the abandoned query's results on screen.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingSearch = () => {
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    searchTimer.current = null;
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) return;
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      setOutcome({
        id: ++nextId.current,
        emptyMessage: `"${echoQuery(q)}" not found`,
        highlight: q,
        results: searchRoster(q, rosterRef.current).map((p) => ({
          key: `p:${p.characterId}`,
          kind: 'pilot' as const,
          pilot: p,
        })),
      });
    }, SEARCH_DEBOUNCE_MS);
    return cancelPendingSearch;
  }, [query]);

  // A fresh outcome object every search means this re-arms on each result set.
  useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(() => setOutcome(null), RESULT_TTL_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  async function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    // The clipboard is only readable while the event is being dispatched, so
    // parse and claim the paste before anything is awaited.
    const rows = parseDscanPaste(e.clipboardData.getData('text'));
    if (rows.length === 0) return; // not D-Scan — let it land as a typed query
    e.preventDefault();
    cancelPendingSearch();

    // Which type ids are hulls comes from the SDE, memoised for the session:
    // only the first paste after a reload costs a request. Null when it failed,
    // which `requestJson` has already surfaced as a toast.
    const shipTypes = await fetchShipTypeGroups();
    const roster = rosterRef.current;
    // A scan lists everything in range, most of it not a ship at all; only what
    // the SDE files under the Ship category belongs against a ship list.
    // Gating on the parsed rows rather than the ship rows keeps a scan holding
    // no ships from being mistaken for a typed query.
    //
    // Anything a tracked pilot is flying is a ship by demonstration, so the
    // panel still recognises its own fleet even with no catalog to consult.
    const ships = rows.filter(
      (row) =>
        (shipTypes?.has(row.typeId) ?? false) || roster.some((p) => p.shipTypeId === row.typeId),
    );
    const resolved: SearchResult[] = ships.map((row, i) => {
      const key = `d:${row.typeId}:${i}`;
      const pilot = matchDscanRow(row, roster);
      return pilot
        ? { key, kind: 'pilot' as const, pilot }
        : {
            key,
            kind: 'unknown' as const,
            name: row.name,
            typeName: row.typeName,
            shipClass: resolveShipClass(row.typeId, shipTypes?.get(row.typeId) ?? null),
          };
    });
    setQuery('');
    setOutcome({
      id: ++nextId.current,
      emptyMessage: 'No ships in D-SCAN',
      highlight: null,
      // Unknown pilots lead: a hull nobody on the map is flying is the reason to
      // read a D-Scan at all. Scan order is kept within each group.
      results: [
        ...resolved.filter((r) => r.kind === 'unknown'),
        ...resolved.filter((r) => r.kind === 'pilot'),
      ],
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        value={query}
        placeholder="Search or paste D-SCAN"
        aria-label="Search or paste D-SCAN"
        className="h-7 text-xs"
        onPaste={(e) => void handlePaste(e)}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length === 0) setOutcome(null);
        }}
      />
      {outcome && <ResultArea key={outcome.id} outcome={outcome} />}
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
export function SystemOverlay({ viewData }: { viewData: MapViewData }) {
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
      {others.length > 0 && <PilotSearch others={others} />}
      <Pilots others={others} />
      {node && <Connections node={node} viewData={viewData} />}
    </div>
  );
}
