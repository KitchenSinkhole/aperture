import { describe, expect, it } from 'vitest';
import { matchDscanRow, resolveDscan } from '@/components/map/SystemOverlay';
import { parseDscanPaste } from '@/lib/map/dscanParser';
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

  it('ignores the whitespace ESI keeps in a ship name and the paste drops', () => {
    // A hull named with a trailing space: ESI stores it, a tab-less paste loses it.
    const trailing = pilot({ characterId: 7, characterName: 'Bob', shipName: 'Nancy ' });
    expect(matchDscanRow(row({ name: 'Nancy' }), [trailing])).toBe(trailing);
    // A run of three spaces narrows to two on the tab-less paste path.
    const run = pilot({ characterId: 8, characterName: 'Amy', shipName: 'My   Ship' });
    expect(matchDscanRow(row({ name: 'My  Ship' }), [run])).toBe(run);
  });

  it('resolves the padded field row whose name ends in a space', () => {
    // Verbatim from a production clipboard: the name cell is `░ BOOOP BEEEP ░ `,
    // so five spaces sit before the Type where every other row has four.
    const line = '641    ░ BOOOP BEEEP ░     Megathron    -';
    const [scanned] = parseDscanPaste(line);
    const smitth = pilot({
      characterId: 7,
      characterName: 'Agent Smitth',
      shipTypeId: 641,
      shipTypeName: 'Megathron',
      shipName: '░ BOOOP BEEEP ░ ',
    });
    expect(scanned).toEqual({ typeId: 641, name: '░ BOOOP BEEEP ░', typeName: 'Megathron' });
    expect(matchDscanRow(scanned!, [smitth])).toBe(smitth);
    expect(matchDscanRow(scanned!, [{ ...smitth, shipTypeId: 11202 }])).toBeNull();
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

describe('resolveDscan', () => {
  const all = (...pilots: MapPresenceEntry[]) => new Set(pilots.map((p) => p.characterId));

  it('records each shown pilot with the hull the scan listed them in', () => {
    const bob = pilot({ characterId: 7, characterName: 'Bob' });
    const out = resolveDscan([row({ name: "Bob's Prospect" })], [bob], all(bob));
    expect(out.unmatched).toEqual([]);
    expect([...out.scannedHullByChar]).toEqual([[7, 33697]]);
  });

  it('gives two friendlies sharing a hull name one row each', () => {
    const bob = pilot({ characterId: 7, characterName: 'Bob', shipName: 'Nancy' });
    const amy = pilot({ characterId: 8, characterName: 'Amy', shipName: 'Nancy' });
    const out = resolveDscan(
      [row({ name: 'Nancy' }), row({ name: 'Nancy' })],
      [bob, amy],
      all(bob, amy),
    );
    expect(out.unmatched).toEqual([]);
    expect([...out.scannedHullByChar.keys()].sort()).toEqual([7, 8]);
  });

  it('leaves a second row on the same pilot unmatched', () => {
    // A hostile under a copied name, or a spare hull on grid: one pilot, two ships.
    const bob = pilot({ characterId: 7, characterName: 'Bob' });
    const twice = [row({ name: "Bob's Prospect" }), row({ name: "Bob's Prospect" })];
    const out = resolveDscan(twice, [bob], all(bob));
    expect(out.unmatched).toEqual([twice[1]]);
    expect([...out.scannedHullByChar]).toEqual([[7, 33697]]);
  });

  it('resolves a pilot the table does not show without recording them', () => {
    // The active character: their own hull must not pin, but they have no row.
    const me = pilot({ characterId: 1, characterName: 'Me' });
    const out = resolveDscan([row({ name: "Me's Prospect" })], [me], new Set());
    expect(out.unmatched).toEqual([]);
    expect(out.scannedHullByChar.size).toBe(0);
  });
});
