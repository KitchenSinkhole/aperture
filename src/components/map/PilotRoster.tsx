'use client';

import { useEffect, useMemo, useState } from 'react';
import { Crown, Search, UsersRound } from 'lucide-react';
import { EmptyRow } from '@/components/dialogs/infoTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { customShipName, PilotRosterTable } from '@/components/map/PilotRosterTable';
import type { MapPresenceEntry, MapSystemNode } from '@/types';

// Per-browser roster view preferences. The group + show-mains toggles persist so
// the roster keeps your layout across popover open/close and reloads.
const ROSTER_PREFS_KEY = 'aperture:pilot-roster:prefs';

type RosterPrefs = { grouped: boolean; showOwner: boolean };

const DEFAULT_PREFS: RosterPrefs = { grouped: false, showOwner: true };

function loadRosterPrefs(): RosterPrefs {
  try {
    const raw = localStorage.getItem(ROSTER_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<RosterPrefs>;
    return {
      grouped: typeof parsed.grouped === 'boolean' ? parsed.grouped : DEFAULT_PREFS.grouped,
      showOwner: typeof parsed.showOwner === 'boolean' ? parsed.showOwner : DEFAULT_PREFS.showOwner,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function matchesQuery(p: MapPresenceEntry, needle: string): boolean {
  if (!needle) return true;
  return [p.characterName, p.mainCharacterName, p.systemName, p.shipTypeName, customShipName(p)].some(
    (v) => v != null && v !== '' && v.toLowerCase().includes(needle),
  );
}

/**
 * Sortable, filterable pilot roster popover body — toolbar (filter input +
 * Group/Mains toggles) above a `PilotRosterTable`. Filters the presence list
 * before passing it to the table. Persists the Group and Mains toggle state to
 * localStorage across open/close cycles.
 */
export function PilotRoster({
  presence,
  systemNameById,
  viewerIds,
}: {
  presence: readonly MapPresenceEntry[];
  systemNameById: Map<number, MapSystemNode>;
  /** Character ids whose account currently has this map open in a live socket. */
  viewerIds: ReadonlySet<number>;
}) {
  const [query, setQuery] = useState('');
  const [prefs] = useState(loadRosterPrefs);
  const [grouped, setGrouped] = useState(prefs.grouped);
  const [showOwner, setShowOwner] = useState(prefs.showOwner);

  useEffect(() => {
    localStorage.setItem(
      ROSTER_PREFS_KEY,
      JSON.stringify({ grouped, showOwner } satisfies RosterPrefs),
    );
  }, [grouped, showOwner]);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle ? presence.filter((p) => matchesQuery(p, needle)) : presence),
    [presence, needle],
  );

  // Distinct from a filtered-to-empty result: with no tracked pilots online there
  // is nothing to sort or filter, so skip the toolbar entirely.
  if (presence.length === 0) return <EmptyRow>No tracked pilots are online.</EmptyRow>;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 p-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter pilots…"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          variant={grouped ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={grouped}
          onClick={() => setGrouped((g) => !g)}
        >
          <UsersRound />
          Group
        </Button>
        <Button
          variant={showOwner && !grouped ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={showOwner}
          disabled={grouped}
          title={grouped ? 'Mains are shown as group anchors' : "Show each alt's main"}
          onClick={() => setShowOwner((s) => !s)}
        >
          <Crown />
          Mains
        </Button>
      </div>

      <PilotRosterTable
        presence={filtered}
        systemNameById={systemNameById}
        viewerIds={viewerIds}
        showHeaders
        showGroupedPlayers={grouped}
        showOwner={showOwner}
      />
    </div>
  );
}
