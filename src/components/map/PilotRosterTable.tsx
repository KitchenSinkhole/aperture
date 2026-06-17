'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp, CornerDownRight, Unplug } from 'lucide-react';
import { EmptyRow, InfoTable, ScrollTable, Td, Th } from '@/components/dialogs/infoTable';
import { systemClassColor } from '@/components/map/styling';
import { cn } from '@/lib/utils';
import type { MapPresenceEntry, MapSystemNode } from '@/types';

// Stable empty default so optional callers don't trigger re-renders from a new
// object reference on every render.
const EMPTY_SYSTEM_MAP: Map<number, MapSystemNode> = new Map();

function classLabel(security: string | null, trueSec: number | null): string {
  if (security) return security;
  if (trueSec != null) return trueSec.toFixed(1);
  return '?';
}

/** The pilot's *custom* hull name, or '' when un-renamed (ESI defaults `ship_name` to the type). */
export function customShipName(p: MapPresenceEntry): string {
  return p.shipName && p.shipName !== p.shipTypeName ? p.shipName : '';
}

type SortKey = 'name' | 'location' | 'ship-type' | 'ship-name';
type SortDir = 'asc' | 'desc';
type Sort = { key: SortKey; dir: SortDir };

function sortValue(p: MapPresenceEntry, key: SortKey): string {
  switch (key) {
    case 'name':
      return p.characterName;
    case 'location':
      return p.systemName ?? String(p.systemId);
    case 'ship-type':
      return p.shipTypeName ?? '';
    case 'ship-name':
      return customShipName(p);
  }
}

function compare(a: MapPresenceEntry, b: MapPresenceEntry, sort: Sort): number {
  const av = sortValue(a, sort.key);
  const bv = sortValue(b, sort.key);
  // Blank values (no custom ship name, unknown type) always sink to the bottom,
  // regardless of direction — sorting shouldn't float empties to the top.
  if (av === '' && bv !== '') return 1;
  if (bv === '' && av !== '') return -1;
  const base = av.localeCompare(bv) || a.characterName.localeCompare(b.characterName);
  return sort.dir === 'asc' ? base : -base;
}

type GroupVM = {
  userId: number;
  /** The account main's own roster entry, when the main is in the presence list (else null). */
  anchor: MapPresenceEntry | null;
  /** Whether `anchor` is the account main (vs. an unbadged fallback when no main is set). */
  anchorIsMain: boolean;
  /** The main's name for a dimmed label when the main is not in the presence list; null if no main is set. */
  mainName: string | null;
  /** Non-anchor members to render indented, in the active sort order. */
  members: MapPresenceEntry[];
  /** Sort key for ordering groups relative to each other. */
  orderKey: string;
};

function pushTo(map: Map<number, MapPresenceEntry[]>, key: number, value: MapPresenceEntry): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Groups an already-filtered presence list by account, anchoring each on its main. */
function buildGroups(presence: readonly MapPresenceEntry[], sort: Sort): GroupVM[] {
  const byUser = new Map<number, MapPresenceEntry[]>();
  for (const p of presence) {
    pushTo(byUser, p.userId, p);
  }

  const groups: GroupVM[] = [];
  for (const [userId, pilots] of byUser) {
    const first = pilots[0];
    if (!first) continue;
    const mainId = first.mainCharacterId;
    const mainName = first.mainCharacterName;
    // The main is shown as a labelled anchor whenever it is present; when absent
    // (filtered out or offline) it shows as a dimmed context row so indented alts
    // still read as belonging to someone.
    const presentMain =
      mainId === null ? null : (pilots.find((p) => p.characterId === mainId) ?? null);

    let anchor: MapPresenceEntry | null;
    let anchorIsMain = false;
    let members: MapPresenceEntry[];
    if (presentMain) {
      anchor = presentMain;
      anchorIsMain = true;
      members = pilots.filter((p) => p.characterId !== mainId);
    } else if (mainName !== null) {
      anchor = null;
      members = pilots.filter((p) => p.characterId !== mainId);
    } else {
      // No main set — anchor on the first sorted member, unbadged.
      const sorted = [...pilots].sort((a, b) => compare(a, b, sort));
      anchor = sorted[0] ?? null;
      members = sorted.slice(1);
    }
    members.sort((a, b) => compare(a, b, sort));

    groups.push({
      userId,
      anchor,
      anchorIsMain,
      mainName: presentMain ? null : mainName,
      members,
      orderKey: mainName ?? anchor?.characterName ?? members[0]?.characterName ?? '',
    });
  }

  groups.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  return groups;
}

function LocationCell({
  p,
  systemNameById,
}: {
  p: MapPresenceEntry;
  systemNameById: Map<number, MapSystemNode>;
}) {
  // Name + class ride the presence entry (resolved server-side, so they work even
  // when the pilot's system isn't placed on the map). The tag is map-specific, so
  // it comes from the placed node when there is one.
  const tag = systemNameById.get(p.systemId)?.tag ?? null;
  const color = systemClassColor(p.systemSecurity);
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono font-bold" style={{ color }}>
        {classLabel(p.systemSecurity, p.systemTrueSec)}
      </span>
      {tag && (
        <span className="font-mono font-bold" style={{ color }}>
          {tag}
        </span>
      )}
      <span>{p.systemName ?? p.systemId}</span>
    </span>
  );
}

function PilotRow({
  p,
  systemNameById,
  viewerIds,
  indent = false,
  isMain = false,
  showOwner = false,
  showLocationColumn = true,
}: {
  p: MapPresenceEntry;
  systemNameById: Map<number, MapSystemNode>;
  /** Omitted when the caller has no viewer data — then the Unplug icon is never shown. */
  viewerIds?: ReadonlySet<number>;
  /** Render as an indented alt beneath its main (grouped mode). */
  indent?: boolean;
  /** Tag the row as the account main. */
  isMain?: boolean;
  /** Annotate an alt row with its main's name (ungrouped mode). */
  showOwner?: boolean;
  showLocationColumn?: boolean;
}) {
  // Online (in-game) is what put the pilot on this roster; the icon flags the
  // ones who don't also have the map open in Aperture right now. Without viewer
  // data we can't make that claim, so the icon stays hidden.
  const mapOpen = !viewerIds || viewerIds.has(p.characterId);
  const ownerName =
    showOwner && p.mainCharacterId !== null && p.mainCharacterId !== p.characterId
      ? p.mainCharacterName
      : null;
  return (
    <tr className="border-t border-foreground/10">
      <Td>
        <span className={cn('flex items-center gap-1.5')}>
          {indent && (
            <CornerDownRight className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />
          )}
          <span>{p.characterName}</span>
          {ownerName && (
            <span className="text-muted-foreground" title={`Alt of ${ownerName}`}>
              ({ownerName})
            </span>
          )}
          {isMain && (
            <span className="rounded bg-muted px-1 text-[9px] font-semibold uppercase text-muted-foreground">
              main
            </span>
          )}
          {!mapOpen && (
            <span title="Online in-game, but doesn't have this map open in Aperture">
              <Unplug className="size-3.5 text-amber-500" aria-hidden />
            </span>
          )}
        </span>
      </Td>
      {showLocationColumn && (
        <Td>
          <LocationCell p={p} systemNameById={systemNameById} />
        </Td>
      )}
      <Td className="text-muted-foreground">{p.shipTypeName ?? '—'}</Td>
      <Td className="text-muted-foreground">{customShipName(p) || '—'}</Td>
    </tr>
  );
}

function SortableTh({
  label,
  columnKey,
  sort,
  onSort,
}: {
  label: string;
  columnKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === columnKey;
  return (
    <Th>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className="flex items-center gap-1 uppercase transition-colors hover:text-foreground"
      >
        {label}
        {active &&
          (sort.dir === 'asc' ? (
            <ChevronUp className="size-3" aria-hidden />
          ) : (
            <ChevronDown className="size-3" aria-hidden />
          ))}
      </button>
    </Th>
  );
}

/**
 * Pure sortable pilot table. Receives an already-filtered presence list from the
 * caller. Manages its own sort state; grouping mode and display flags are
 * controlled via props. Renders a "No pilots match your filter" empty state when
 * the received list is empty.
 */
export function PilotRosterTable({
  presence,
  systemNameById = EMPTY_SYSTEM_MAP,
  viewerIds,
  showHeaders = true,
  showLocationColumn = true,
  showGroupedPlayers = false,
  showOwner = false,
  scrollable = true,
}: {
  /** Pre-filtered pilot list — the table sorts and optionally groups, but does not re-filter. */
  presence: readonly MapPresenceEntry[];
  /** Required when `showLocationColumn` is true; safe to omit otherwise. */
  systemNameById?: Map<number, MapSystemNode>;
  /** When omitted, the Unplug icon is never shown (all pilots considered to have the map open). */
  viewerIds?: ReadonlySet<number>;
  showHeaders?: boolean;
  showLocationColumn?: boolean;
  /** Cluster each account's pilots under their main anchor. */
  showGroupedPlayers?: boolean;
  /** Annotate alt rows with their main's name in the flat (ungrouped) view. */
  showOwner?: boolean;
  /** Wrap the table in a height-capped, bordered scroll region. Defaults to true. */
  scrollable?: boolean;
}) {
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });

  const onSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );

  const flat = useMemo(() => [...presence].sort((a, b) => compare(a, b, sort)), [presence, sort]);
  const groups = useMemo(
    () => (showGroupedPlayers ? buildGroups(presence, sort) : []),
    [showGroupedPlayers, presence, sort],
  );

  if (presence.length === 0) return <EmptyRow>No pilots match your filter.</EmptyRow>;

  const table = (
    <InfoTable>
      {showHeaders && (
        <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase text-muted-foreground">
          <tr>
            <SortableTh label="Pilot" columnKey="name" sort={sort} onSort={onSort} />
            {showLocationColumn && (
              <SortableTh label="Location" columnKey="location" sort={sort} onSort={onSort} />
            )}
            <SortableTh label="Type" columnKey="ship-type" sort={sort} onSort={onSort} />
            <SortableTh label="Ship" columnKey="ship-name" sort={sort} onSort={onSort} />
          </tr>
        </thead>
      )}
      <tbody>
        {showGroupedPlayers
          ? groups.flatMap((g) => {
              const rows: ReactElement[] = [];
              if (g.anchor) {
                rows.push(
                  <PilotRow
                    key={g.anchor.characterId}
                    p={g.anchor}
                    systemNameById={systemNameById}
                    viewerIds={viewerIds}
                    isMain={g.anchorIsMain}
                    showLocationColumn={showLocationColumn}
                  />,
                );
              } else if (g.mainName !== null) {
                rows.push(
                  <tr key={`main-${g.userId}`} className="border-t border-foreground/10">
                    <Td className="text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="italic">{g.mainName}</span>
                        <span className="rounded bg-muted px-1 text-[9px] font-semibold uppercase">
                          main · offline
                        </span>
                      </span>
                    </Td>
                    {showLocationColumn && <Td>{null}</Td>}
                    <Td>{null}</Td>
                    <Td>{null}</Td>
                  </tr>,
                );
              }
              for (const m of g.members) {
                rows.push(
                  <PilotRow
                    key={m.characterId}
                    p={m}
                    systemNameById={systemNameById}
                    viewerIds={viewerIds}
                    indent
                    showLocationColumn={showLocationColumn}
                  />,
                );
              }
              return rows;
            })
          : flat.map((p) => (
              <PilotRow
                key={p.characterId}
                p={p}
                systemNameById={systemNameById}
                viewerIds={viewerIds}
                showOwner={showOwner}
                showLocationColumn={showLocationColumn}
              />
            ))}
      </tbody>
    </InfoTable>
  );

  return scrollable ? <ScrollTable>{table}</ScrollTable> : table;
}
