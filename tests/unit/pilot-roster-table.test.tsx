import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PilotRosterTable, customShipName } from '@/components/map/PilotRosterTable';
import type { MapPresenceEntry } from '@/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pilot(
  overrides: Partial<MapPresenceEntry> & { characterId: number; characterName: string },
): MapPresenceEntry {
  return {
    userId: overrides.characterId,
    mainCharacterId: null,
    mainCharacterName: null,
    systemId: 30000142,
    systemName: 'Jita',
    systemSecurity: null,
    systemTrueSec: 0.9,
    shipTypeId: 670,
    shipTypeName: 'Capsule',
    shipName: null,
    locationAt: '2026-06-17T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DOM render harness (mirrors the project's react-dom/client convention —
// no @testing-library in this repo).
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui: React.ReactElement): void {
  act(() => {
    root.render(ui);
  });
}

/** Header button labels in their rendered left-to-right order. */
function headerLabels(): string[] {
  return Array.from(container.querySelectorAll('thead th button')).map(
    (b) => b.textContent?.trim() ?? '',
  );
}

/** Clicks the sortable header whose label matches (case-insensitive). */
function clickHeader(label: string): void {
  const btn = Array.from(container.querySelectorAll('thead th button')).find(
    (b) => b.textContent?.trim().toLowerCase() === label.toLowerCase(),
  ) as HTMLElement | undefined;
  if (!btn) throw new Error(`No header button labelled "${label}"`);
  act(() => btn.click());
}

function bodyRows(): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
}

/** The pilot/owner name carried in each body row's first cell, top to bottom. */
function rowNames(): string[] {
  return bodyRows().map((tr) => {
    const firstCell = tr.querySelector('td');
    // The name lives in the first nested <span> of the cell's flex wrapper.
    return firstCell?.querySelector('span span')?.textContent?.trim() ?? '';
  });
}

// ---------------------------------------------------------------------------
// customShipName (pure)
// ---------------------------------------------------------------------------

describe('customShipName', () => {
  it('returns the custom hull name when it differs from the ship type', () => {
    expect(customShipName(pilot({ characterId: 1, characterName: 'A', shipName: 'Pointy' }))).toBe(
      'Pointy',
    );
  });

  it('returns "" when the ship name equals the type (ESI default)', () => {
    expect(
      customShipName(
        pilot({ characterId: 1, characterName: 'A', shipTypeName: 'Loki', shipName: 'Loki' }),
      ),
    ).toBe('');
  });

  it('returns "" when the ship name is null', () => {
    expect(customShipName(pilot({ characterId: 1, characterName: 'A', shipName: null }))).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('PilotRosterTable — empty state', () => {
  it('renders the filter empty message and no table when presence is empty', () => {
    render(<PilotRosterTable presence={[]} />);
    expect(container.textContent).toContain('No pilots match your filter.');
    expect(container.querySelector('table')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Column visibility
// ---------------------------------------------------------------------------

describe('PilotRosterTable — column visibility', () => {
  const presence = [pilot({ characterId: 1, characterName: 'Alpha' })];

  it('shows all four columns including Location by default', () => {
    render(<PilotRosterTable presence={presence} />);
    expect(headerLabels()).toEqual(['Pilot', 'Location', 'Type', 'Ship']);
  });

  it('omits the Location header and cell when showLocationColumn is false', () => {
    render(<PilotRosterTable presence={presence} showLocationColumn={false} />);
    expect(headerLabels()).toEqual(['Pilot', 'Type', 'Ship']);
    // Header dropped + the matching body cell dropped (4 → 3).
    expect(bodyRows()[0]!.querySelectorAll('td')).toHaveLength(3);
  });

  it('renders four body cells per row when the Location column is shown', () => {
    render(<PilotRosterTable presence={presence} />);
    expect(bodyRows()[0]!.querySelectorAll('td')).toHaveLength(4);
  });

  it('omits the header row entirely when showHeaders is false', () => {
    render(<PilotRosterTable presence={presence} showHeaders={false} />);
    expect(container.querySelector('thead')).toBeNull();
    // Body still renders.
    expect(bodyRows()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scrollable wrapper
// ---------------------------------------------------------------------------

describe('PilotRosterTable — scrollable wrapper', () => {
  const presence = [pilot({ characterId: 1, characterName: 'Alpha' })];

  it('wraps the table in a scroll region by default', () => {
    render(<PilotRosterTable presence={presence} />);
    expect(container.querySelector('.overflow-auto')).not.toBeNull();
  });

  it('renders a bare table (no scroll region) when scrollable is false', () => {
    render(<PilotRosterTable presence={presence} scrollable={false} />);
    expect(container.querySelector('.overflow-auto')).toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Connection status (Unplug icon)
// ---------------------------------------------------------------------------

const UNPLUG_TITLE = "Online in-game, but doesn't have this map open in Aperture";

describe('PilotRosterTable — connection status', () => {
  const presence = [
    pilot({ characterId: 1, characterName: 'Connected' }),
    pilot({ characterId: 2, characterName: 'NoMapOpen' }),
  ];

  function unpluggedRowNames(): string[] {
    return bodyRows()
      .filter((tr) => tr.querySelector(`[title="${UNPLUG_TITLE}"]`))
      .map((tr) => tr.querySelector('td span span')?.textContent?.trim() ?? '');
  }

  it('flags only pilots absent from viewerIds with the Unplug icon', () => {
    render(<PilotRosterTable presence={presence} viewerIds={new Set([1])} />);
    expect(unpluggedRowNames()).toEqual(['NoMapOpen']);
  });

  it('flags every pilot when viewerIds is empty', () => {
    render(<PilotRosterTable presence={presence} viewerIds={new Set()} />);
    expect(unpluggedRowNames().sort()).toEqual(['Connected', 'NoMapOpen']);
  });

  it('shows the icon for nobody when viewerIds is omitted (viewing status unknown)', () => {
    render(<PilotRosterTable presence={presence} />);
    expect(container.querySelector(`[title="${UNPLUG_TITLE}"]`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sorting (flat / ungrouped)
// ---------------------------------------------------------------------------

describe('PilotRosterTable — sorting', () => {
  it('defaults to character name ascending', () => {
    const presence = [
      pilot({ characterId: 3, characterName: 'Charlie' }),
      pilot({ characterId: 1, characterName: 'Alpha' }),
      pilot({ characterId: 2, characterName: 'Bravo' }),
    ];
    render(<PilotRosterTable presence={presence} />);
    expect(rowNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('flips to descending when the active header is clicked again', () => {
    const presence = [
      pilot({ characterId: 1, characterName: 'Alpha' }),
      pilot({ characterId: 2, characterName: 'Bravo' }),
    ];
    render(<PilotRosterTable presence={presence} />);
    clickHeader('Pilot'); // name is already active asc → flips to desc
    expect(rowNames()).toEqual(['Bravo', 'Alpha']);
  });

  it('sorts by ship type and sinks unknown (blank) types to the bottom', () => {
    const presence = [
      pilot({ characterId: 1, characterName: 'Alpha', shipTypeName: 'Tengu' }),
      pilot({ characterId: 2, characterName: 'Bravo', shipTypeName: null }),
      pilot({ characterId: 3, characterName: 'Charlie', shipTypeName: 'Loki' }),
    ];
    render(<PilotRosterTable presence={presence} />);
    clickHeader('Type');
    // Loki < Tengu, then the null-type pilot regardless of direction.
    expect(rowNames()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('keeps blank ship types at the bottom even when sorting descending', () => {
    const presence = [
      pilot({ characterId: 1, characterName: 'Alpha', shipTypeName: 'Tengu' }),
      pilot({ characterId: 2, characterName: 'Bravo', shipTypeName: null }),
      pilot({ characterId: 3, characterName: 'Charlie', shipTypeName: 'Loki' }),
    ];
    render(<PilotRosterTable presence={presence} />);
    clickHeader('Type'); // asc
    clickHeader('Type'); // desc
    expect(rowNames()).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it('breaks ship-type ties on character name', () => {
    const presence = [
      pilot({ characterId: 1, characterName: 'Zara', shipTypeName: 'Loki' }),
      pilot({ characterId: 2, characterName: 'Adam', shipTypeName: 'Loki' }),
    ];
    render(<PilotRosterTable presence={presence} />);
    clickHeader('Type');
    expect(rowNames()).toEqual(['Adam', 'Zara']);
  });

  it('sorts by custom ship name, sinking un-renamed hulls to the bottom', () => {
    const presence = [
      pilot({ characterId: 1, characterName: 'Alpha', shipName: 'Zephyr' }),
      pilot({ characterId: 2, characterName: 'Bravo', shipName: null }),
      pilot({ characterId: 3, characterName: 'Charlie', shipName: 'Banana' }),
    ];
    render(<PilotRosterTable presence={presence} />);
    clickHeader('Ship');
    expect(rowNames()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('sorts by location using the system name', () => {
    const presence = [
      pilot({ characterId: 1, characterName: 'Alpha', systemName: 'Tama' }),
      pilot({ characterId: 2, characterName: 'Bravo', systemName: 'Amarr' }),
    ];
    render(<PilotRosterTable presence={presence} />);
    clickHeader('Location');
    expect(rowNames()).toEqual(['Bravo', 'Alpha']);
  });
});

// ---------------------------------------------------------------------------
// Owner annotation (flat view)
// ---------------------------------------------------------------------------

describe('PilotRosterTable — showOwner', () => {
  const presence = [
    pilot({
      characterId: 10,
      characterName: 'TheMain',
      userId: 1,
      mainCharacterId: 10,
      mainCharacterName: 'TheMain',
    }),
    pilot({
      characterId: 11,
      characterName: 'AnAlt',
      userId: 1,
      mainCharacterId: 10,
      mainCharacterName: 'TheMain',
    }),
  ];

  it('annotates alt rows with their main name when showOwner is on', () => {
    render(<PilotRosterTable presence={presence} showOwner />);
    const altRow = bodyRows().find((tr) => tr.textContent?.includes('AnAlt'))!;
    expect(altRow.querySelector('[title="Alt of TheMain"]')).not.toBeNull();
    expect(altRow.textContent).toContain('(TheMain)');
  });

  it('does not annotate the account main itself', () => {
    render(<PilotRosterTable presence={presence} showOwner />);
    const mainRow = bodyRows().find((tr) => tr.textContent?.startsWith('TheMain'))!;
    expect(mainRow.querySelector('[title^="Alt of"]')).toBeNull();
  });

  it('does not annotate any row when showOwner is off (default)', () => {
    render(<PilotRosterTable presence={presence} />);
    expect(container.querySelector('[title^="Alt of"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Grouping (showGroupedPlayers)
// ---------------------------------------------------------------------------

describe('PilotRosterTable — grouping', () => {
  it('anchors each account on its present main, badged, with alts indented below', () => {
    const presence = [
      pilot({ characterId: 11, characterName: 'AltTwo', userId: 1, mainCharacterId: 10, mainCharacterName: 'MainOne' }),
      pilot({ characterId: 12, characterName: 'AltOne', userId: 1, mainCharacterId: 10, mainCharacterName: 'MainOne' }),
      pilot({ characterId: 10, characterName: 'MainOne', userId: 1, mainCharacterId: 10, mainCharacterName: 'MainOne' }),
    ];
    render(<PilotRosterTable presence={presence} showGroupedPlayers />);

    // Main first (sorted alts follow): MainOne, AltOne, AltTwo.
    expect(rowNames()).toEqual(['MainOne', 'AltOne', 'AltTwo']);

    const rows = bodyRows();
    // The anchor carries the "main" badge; the alts carry the indent glyph.
    expect(rows[0]!.textContent).toContain('main');
    expect(rows[0]!.querySelector('.lucide-corner-down-right')).toBeNull();
    expect(rows[1]!.querySelector('.lucide-corner-down-right')).not.toBeNull();
    expect(rows[2]!.querySelector('.lucide-corner-down-right')).not.toBeNull();
  });

  it('shows a dimmed "main · offline" placeholder when the main is absent', () => {
    const presence = [
      pilot({ characterId: 11, characterName: 'AltTwo', userId: 1, mainCharacterId: 10, mainCharacterName: 'MainOne' }),
      pilot({ characterId: 12, characterName: 'AltOne', userId: 1, mainCharacterId: 10, mainCharacterName: 'MainOne' }),
    ];
    render(<PilotRosterTable presence={presence} showGroupedPlayers />);

    expect(container.textContent).toContain('main · offline');
    // Placeholder labels the absent main; alts still render indented beneath it.
    expect(rowNames()).toEqual(['MainOne', 'AltOne', 'AltTwo']);
    const rows = bodyRows();
    expect(rows[1]!.querySelector('.lucide-corner-down-right')).not.toBeNull();
    expect(rows[2]!.querySelector('.lucide-corner-down-right')).not.toBeNull();
  });

  it('anchors on the first sorted member, unbadged, when no main is set', () => {
    const presence = [
      pilot({ characterId: 21, characterName: 'Zeb', userId: 2, mainCharacterId: null, mainCharacterName: null }),
      pilot({ characterId: 22, characterName: 'Ann', userId: 2, mainCharacterId: null, mainCharacterName: null }),
    ];
    render(<PilotRosterTable presence={presence} showGroupedPlayers />);

    expect(rowNames()).toEqual(['Ann', 'Zeb']);
    const rows = bodyRows();
    expect(rows[0]!.textContent).not.toContain('main');
    expect(rows[0]!.querySelector('.lucide-corner-down-right')).toBeNull();
    expect(rows[1]!.querySelector('.lucide-corner-down-right')).not.toBeNull();
  });

  it('orders groups by main name', () => {
    const presence = [
      pilot({ characterId: 30, characterName: 'Zeta', userId: 3, mainCharacterId: 30, mainCharacterName: 'Zeta' }),
      pilot({ characterId: 40, characterName: 'Alpha', userId: 4, mainCharacterId: 40, mainCharacterName: 'Alpha' }),
    ];
    render(<PilotRosterTable presence={presence} showGroupedPlayers />);
    expect(rowNames()).toEqual(['Alpha', 'Zeta']);
  });
});
