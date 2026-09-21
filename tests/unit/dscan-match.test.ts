import { describe, expect, it } from 'vitest';
import { matchDscanRow } from '@/components/map/SystemOverlay';
import type { MapPresenceEntry, ParsedDscanRow } from '@/types';

function pilot(over: Partial<MapPresenceEntry> & { characterName: string }): MapPresenceEntry {
  return {
    characterId: 1,
    userId: 1,
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

const row = (over: Partial<ParsedDscanRow> = {}): ParsedDscanRow => ({
  typeId: 33697,
  name: "Bob's Prospect",
  typeName: 'Prospect',
  ...over,
});

describe('matchDscanRow', () => {
  it('matches a renamed hull on its exact ship name', () => {
    const bob = pilot({ characterId: 7, characterName: 'Bob', shipName: 'Nancy' });
    expect(matchDscanRow(row({ name: 'Nancy' }), [bob])).toBe(bob);
  });

  it('compares ship names case-insensitively', () => {
    const bob = pilot({ characterId: 7, characterName: 'Bob', shipName: 'NaNcY' });
    expect(matchDscanRow(row({ name: 'nancy' }), [bob])).toBe(bob);
  });

  it("falls back to the client's <Pilot>'s <Type> default", () => {
    const bob = pilot({ characterId: 7, characterName: 'Bob' });
    expect(matchDscanRow(row({ name: "Bob's Prospect" }), [bob])).toBe(bob);
  });

  it('requires the hull type id to agree', () => {
    const bob = pilot({ characterId: 7, characterName: 'Bob', shipName: 'Nancy' });
    expect(matchDscanRow(row({ typeId: 11202, name: 'Nancy' }), [bob])).toBeNull();
    expect(matchDscanRow(row({ typeId: 11202, name: "Bob's Prospect" }), [bob])).toBeNull();
  });

  it('anchors the default naming at the start, so a name prefix cannot claim a hull', () => {
    // "Bob" must not answer for "Bobby's Prospect".
    const bob = pilot({ characterId: 7, characterName: 'Bob' });
    expect(matchDscanRow(row({ name: "Bobby's Prospect" }), [bob])).toBeNull();
  });

  it('does not match a pilot named inside the hull name', () => {
    const bob = pilot({ characterId: 7, characterName: 'Bob' });
    expect(matchDscanRow(row({ name: "Scout for Bob's Prospect" }), [bob])).toBeNull();
  });

  it('prefers the exact ship name over the default naming', () => {
    const bob = pilot({ characterId: 7, characterName: 'Bob' });
    const amy = pilot({ characterId: 8, characterName: 'Amy', shipName: "Bob's Prospect" });
    expect(matchDscanRow(row({ name: "Bob's Prospect" }), [bob, amy])).toBe(amy);
  });

  it('resolves a shared hull name to a roster pilot rather than pinning a hostile', () => {
    // Two friendlies on the same hull under the same name: the row is one of
    // them either way, so it belongs in the table, not in the red rows.
    const one = pilot({ characterId: 7, characterName: 'Bob', shipName: 'Nancy' });
    const two = pilot({ characterId: 8, characterName: 'Amy', shipName: 'Nancy' });
    expect(matchDscanRow(row({ name: 'Nancy' }), [one, two])).not.toBeNull();
  });

  it('returns null for a hull nobody on the roster flies', () => {
    const bob = pilot({ characterId: 7, characterName: 'Bob', shipName: 'Nancy' });
    expect(matchDscanRow(row({ name: "Hostile's Prospect" }), [bob])).toBeNull();
    expect(matchDscanRow(row({ name: 'Nancy' }), [])).toBeNull();
  });

  it('never matches a pilot whose ship name is unknown on the exact path', () => {
    // A null ship name compares as '', which no accepted D-Scan name can be.
    const bob = pilot({ characterId: 7, characterName: 'Bob', shipName: null });
    expect(matchDscanRow(row({ name: 'Nancy' }), [bob])).toBeNull();
  });

  it('ignores a pilot on another hull when two share a ship name', () => {
    const onHull = pilot({ characterId: 7, characterName: 'Bob', shipName: 'Nancy' });
    const elsewhere = pilot({
      characterId: 8,
      characterName: 'Amy',
      shipTypeId: 11202,
      shipTypeName: 'Ares',
      shipName: 'Nancy',
    });
    expect(matchDscanRow(row({ name: 'Nancy' }), [elsewhere, onHull])).toBe(onHull);
  });
});
