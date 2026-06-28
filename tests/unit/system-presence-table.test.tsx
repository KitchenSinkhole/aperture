import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SystemPresenceTable } from '@/components/map/SystemPresenceTable';
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
// DOM render harness (mirrors the project's react-dom/client convention).
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

function bodyRows(): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
}

function rowCells(tr: HTMLTableRowElement): string[] {
  return Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '');
}

describe('SystemPresenceTable', () => {
  it('renders no header row', () => {
    render(<SystemPresenceTable presence={[pilot({ characterId: 1, characterName: 'Alpha' })]} />);
    expect(container.querySelector('thead')).toBeNull();
  });

  it('renders three cells per pilot: name, type, custom ship name', () => {
    render(
      <SystemPresenceTable
        presence={[
          pilot({
            characterId: 1,
            characterName: 'Alpha',
            shipTypeName: 'Loki',
            shipName: 'Wormhole Daddy',
          }),
        ]}
      />,
    );
    expect(rowCells(bodyRows()[0]!)).toEqual(['Alpha', 'Loki', 'Wormhole Daddy']);
  });

  it('shows an em dash for an un-renamed hull (ESI default ship name)', () => {
    render(
      <SystemPresenceTable
        presence={[
          pilot({ characterId: 1, characterName: 'Alpha', shipTypeName: 'Astero', shipName: null }),
        ]}
      />,
    );
    expect(rowCells(bodyRows()[0]!)).toEqual(['Alpha', 'Astero', '—']);
  });

  it('sorts pilots by character name', () => {
    render(
      <SystemPresenceTable
        presence={[
          pilot({ characterId: 3, characterName: 'Charlie' }),
          pilot({ characterId: 1, characterName: 'Alpha' }),
          pilot({ characterId: 2, characterName: 'Bravo' }),
        ]}
      />,
    );
    expect(bodyRows().map((tr) => tr.querySelector('td')?.textContent?.trim())).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });
});
