import { describe, expect, it } from 'vitest';
import { orderPilots, type PilotSort } from '@/components/map/SystemOverlay';
import type { MapPresenceEntry } from '@/types';

function pilot(
  over: Partial<MapPresenceEntry> & { characterId: number; characterName: string },
): MapPresenceEntry {
  return {
    userId: over.characterId,
    mainCharacterId: null,
    mainCharacterName: null,
    systemId: 31000001,
    systemName: 'J123456',
    systemSecurity: 'C3',
    systemTrueSec: null,
    shipTypeId: 33697,
    shipTypeName: 'Prospect',
    shipClass: 'frigate',
    shipName: null,
    locationAt: '2026-09-19T00:00:00.000Z',
    ...over,
  };
}

const byType: PilotSort = { key: 'ship-type', dir: 'asc' };
const names = (list: readonly MapPresenceEntry[]) => list.map((p) => p.characterName);
const scannedIn = (...ids: number[]) => new Map(ids.map((id) => [id, 33697]));
const none = new Map<number, number>();

const amy = pilot({ characterId: 1, characterName: 'Amy', shipTypeName: 'Ares' });
const bob = pilot({ characterId: 2, characterName: 'Bob', shipTypeName: 'Buzzard' });
const cat = pilot({ characterId: 3, characterName: 'Cat', shipTypeName: 'Covetor' });
const dan = pilot({ characterId: 4, characterName: 'Dan', shipTypeName: 'Drake' });
const roster = [dan, cat, bob, amy];

describe('orderPilots', () => {
  it('applies the column sort alone with no query and no scan', () => {
    expect(names(orderPilots(roster, '', none, byType))).toEqual(['Amy', 'Bob', 'Cat', 'Dan']);
  });

  it('lifts the pilots the last D-Scan resolved, sorted among themselves', () => {
    expect(names(orderPilots(roster, '', scannedIn(4, 2), byType))).toEqual([
      'Bob',
      'Dan',
      'Amy',
      'Cat',
    ]);
  });

  it('puts scanned pilots above query hits, and a pilot that is both first of all', () => {
    // 'drake' hits Dan alone; Cat is scanned only.
    expect(names(orderPilots(roster, 'drake', scannedIn(3), byType))).toEqual([
      'Cat',
      'Dan',
      'Amy',
      'Bob',
    ]);
    // 'buzz' hits Bob, who is also scanned, so he leads Cat, who is scanned only.
    expect(names(orderPilots(roster, 'buzz', scannedIn(2, 3), byType))).toEqual([
      'Bob',
      'Cat',
      'Amy',
      'Dan',
    ]);
  });

  it('honours the sort direction within a tier', () => {
    const desc: PilotSort = { key: 'ship-type', dir: 'desc' };
    expect(names(orderPilots(roster, '', scannedIn(1, 2), desc))).toEqual([
      'Bob',
      'Amy',
      'Dan',
      'Cat',
    ]);
  });

  it('drops a scanned pilot back into the plain list once they fly another hull', () => {
    // Dan was scanned in a Prospect and has since reshipped.
    expect(
      names(
        orderPilots(
          roster,
          '',
          new Map([
            [4, 11202],
            [2, 33697],
          ]),
          byType,
        ),
      ),
    ).toEqual(['Bob', 'Amy', 'Cat', 'Dan']);
  });
});
