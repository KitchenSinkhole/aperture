import { describe, expect, it } from 'vitest';
import { parseDscanPaste } from '@/lib/map/dscanParser';
import type { ParsedDscanRow } from '@/types';

/** A real paste is tab-separated: `TypeID, Name, Type, Distance`. */
const tab = (...cells: string[]) => cells.join('\t');
/** Clipboards that strip tabs pad the column gaps with spaces instead. */
const padded = (...cells: string[]) => cells.join('    ');

describe('parseDscanPaste', () => {
  const accepted: [label: string, input: string, expected: ParsedDscanRow[]][] = [
    [
      'a tab-separated scan',
      [
        tab('33697', "Bob Smith's Prospect", 'Prospect', '13 km'),
        tab('35835', 'ARMPIT', 'Athanor', '2,148 km'),
      ].join('\n'),
      [
        { typeId: 33697, name: "Bob Smith's Prospect", typeName: 'Prospect' },
        { typeId: 35835, name: 'ARMPIT', typeName: 'Athanor' },
      ],
    ],
    [
      'the space-padded fallback',
      padded('33697', "Bob's Prospect", 'Prospect', '13 km'),
      [{ typeId: 33697, name: "Bob's Prospect", typeName: 'Prospect' }],
    ],
    [
      'a dash where the distance readout would be',
      tab('35835', 'ARMPIT', 'Athanor', '-'),
      [{ typeId: 35835, name: 'ARMPIT', typeName: 'Athanor' }],
    ],
    [
      'CRLF line endings and blank lines',
      `\r\n${tab('33697', 'Tiny', 'Prospect', '13 km')}\r\n\r\n`,
      [{ typeId: 33697, name: 'Tiny', typeName: 'Prospect' }],
    ],
    [
      'a name holding a tab-path double space',
      tab('33697', 'My  Ship', 'Prospect', '13 km'),
      [{ typeId: 33697, name: 'My  Ship', typeName: 'Prospect' }],
    ],
    [
      'a scan of nothing but structures',
      tab('35835', 'ARMPIT', 'Athanor', '2,148 km'),
      [{ typeId: 35835, name: 'ARMPIT', typeName: 'Athanor' }],
    ],
  ];

  it.each(accepted)('parses %s', (_label, input, expected) => {
    expect(parseDscanPaste(input)).toEqual(expected);
  });

  const rejected: [label: string, input: string][] = [
    ['an empty string', ''],
    ['whitespace only', '   \n\t\n'],
    ['a typed query', 'bob'],
    ['a typed query that looks tabular', tab('bob', 'loki', 'anoikis')],
    ['three columns with a numeric first cell', tab('33697', 'Tiny', 'Prospect')],
    ['a non-numeric first cell', tab('33697x', 'Tiny', 'Prospect', '13 km')],
    ['a blank name cell', tab('33697', '   ', 'Prospect', '13 km')],
    ['a blank type cell', tab('33697', 'Tiny', '   ', '13 km')],
    ['a signature paste', 'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t1.2 AU'],
  ];

  it.each(rejected)('rejects %s', (_label, input) => {
    expect(parseDscanPaste(input)).toEqual([]);
  });

  it('keeps a friendly hull intact when a padded name over-splits', () => {
    // The gap run and the name's own run are indistinguishable once tabs are
    // gone; the Type still has to survive, or the row pins as a false hostile.
    expect(parseDscanPaste(padded('33697', 'My  Ship', 'Prospect', '13 km'))).toEqual([
      { typeId: 33697, name: 'My  Ship', typeName: 'Prospect' },
    ]);
  });

  it('reads the type from the tail however wide the name over-splits', () => {
    expect(parseDscanPaste(padded('33697', 'a  b  c  d', 'Prospect', '13 km'))).toEqual([
      { typeId: 33697, name: 'a  b  c  d', typeName: 'Prospect' },
    ]);
  });

  it('drops only the lines that fail the gate', () => {
    const rows = parseDscanPaste(
      [
        'some stray text',
        tab('33697', 'Tiny', 'Prospect', '13 km'),
        tab('nope', 'Tiny', 'Prospect', '13 km'),
        tab('35835', 'ARMPIT', 'Athanor', '-'),
      ].join('\n'),
    );
    expect(rows.map((r) => r.typeId)).toEqual([33697, 35835]);
  });

  it('keeps scan order', () => {
    const rows = parseDscanPaste(
      [
        tab('35835', 'ARMPIT', 'Athanor', '-'),
        tab('33697', 'Tiny', 'Prospect', '13 km'),
        tab('11202', 'Zed', 'Ares', '5 km'),
      ].join('\n'),
    );
    expect(rows.map((r) => r.typeId)).toEqual([35835, 33697, 11202]);
  });

  it('reports the shared type id, not a per-object one', () => {
    const rows = parseDscanPaste(
      [tab('35835', 'ONE', 'Athanor', '-'), tab('35835', 'TWO', 'Athanor', '-')].join('\n'),
    );
    expect(rows.map((r) => r.typeId)).toEqual([35835, 35835]);
    expect(rows.map((r) => r.name)).toEqual(['ONE', 'TWO']);
  });
});
