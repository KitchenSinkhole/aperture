import { describe, expect, it } from 'vitest';
import { parseSignaturePaste } from '@/lib/map/signatureParser';

/**
 * Pure parser tests for the EVE probe-scanner clipboard format.
 *
 * Format (current EVE client): six tab-separated columns in fixed order
 *   `ID, Class, Group, Name, Signal, Distance`
 * (see docs/reference/signature-scan-results.md). Class and Distance are
 * used/validated but discarded from the output. A row is accepted only when
 * cell 0 is a valid `AAA-NNN` sig id and cell 1 is a recognized localized
 * Class label. The probe scanner never emits a wormhole-type code (A239,
 * K162, etc.), so the parser doesn't try to extract one.
 */

describe('parseSignaturePaste', () => {
  it('parses a standard 6-column tab-separated dump (Case C)', () => {
    const text = [
      'AXP-378\tCosmic Signature\t\t\t0.0%\t8.36 AU',
      'BIF-460\tCosmic Signature\tRelic Site\tForgotten Perimeter Habitation Coils\t100.0%\t10.67 AU',
      'UNO-708\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t17.43 AU',
    ].join('\n');

    expect(parseSignaturePaste(text)).toEqual([
      { sigId: 'AXP-378', name: null, groupName: null, signal: '0.0%' },
      {
        sigId: 'BIF-460',
        name: 'Forgotten Perimeter Habitation Coils',
        groupName: 'Relic Site',
        signal: '100.0%',
      },
      {
        sigId: 'UNO-708',
        name: 'Unstable Wormhole',
        groupName: 'Wormhole',
        signal: '100.0%',
      },
    ]);
  });

  it('parses initial 0.0% rows with blank Group/Name (Case A)', () => {
    const text = [
      'AXP-378\tCosmic Signature\t\t\t0.0%\t8.35 AU',
      'BIF-460\tCosmic Signature\t\t\t0.0%\t10.89 AU',
    ].join('\n');

    expect(parseSignaturePaste(text)).toEqual([
      { sigId: 'AXP-378', name: null, groupName: null, signal: '0.0%' },
      { sigId: 'BIF-460', name: null, groupName: null, signal: '0.0%' },
    ]);
  });

  it('parses a Cosmic Anomaly row (Case D)', () => {
    const text =
      'ASE-500\tCosmic Anomaly\tOre Site\tOrdinary Perimeter Deposit\t100.0%\t14.55 AU';

    expect(parseSignaturePaste(text)).toEqual([
      {
        sigId: 'ASE-500',
        name: 'Ordinary Perimeter Deposit',
        groupName: 'Ore Site',
        signal: '100.0%',
      },
    ]);
  });

  it('skips header rows, blank lines, and garbage', () => {
    const text = [
      'ID\tClass\tGroup\tName\tSignal\tDistance',
      '',
      '',
      'not a real row',
      'AXP-378\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t8.35 AU',
    ].join('\n');

    expect(parseSignaturePaste(text)).toHaveLength(1);
  });

  it('accepts a localized (German) Class label', () => {
    const text =
      'AXP-378\tKosmische Signatur\tWormhole\tUnstable Wormhole\t100.0%\t8.35 AU';

    expect(parseSignaturePaste(text)).toEqual([
      {
        sigId: 'AXP-378',
        name: 'Unstable Wormhole',
        groupName: 'Wormhole',
        signal: '100.0%',
      },
    ]);
  });

  it('rejects a row with a valid sig id but unrecognized Class', () => {
    const text = 'AXP-378\tNot A Class\tWormhole\tUnstable Wormhole\t100.0%\t8.35 AU';
    expect(parseSignaturePaste(text)).toEqual([]);
  });

  it('uppercases sig ids and skips rows whose id does not match AAA-NNN', () => {
    const text = [
      'abc-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t1.23 AU',
      'NOTASIGID\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t1.23 AU',
      'AB-1234\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t1.23 AU',
    ].join('\n');

    const rows = parseSignaturePaste(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sigId).toBe('ABC-123');
  });

  it('returns [] on empty or non-string input', () => {
    expect(parseSignaturePaste('')).toEqual([]);
    expect(parseSignaturePaste('\n\n\n')).toEqual([]);
  });

  it('tolerates trailing whitespace and CRLF line endings', () => {
    const text =
      'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t1.23 AU   \r\n';
    expect(parseSignaturePaste(text)).toEqual([
      {
        sigId: 'ABC-123',
        name: 'Unstable Wormhole',
        groupName: 'Wormhole',
        signal: '100.0%',
      },
    ]);
  });

  it('parses homefront anomalies', () => {
    const text =
      'XFV-531\tCosmic Anomaly\tHomefront Operation Site - Combat Site\tSuspicious Signal: Block the Broadcast\t100.0%\t68.93 AU'
    expect(parseSignaturePaste(text)).toEqual([
      {
        sigId: 'XFV-531',
        name: 'Suspicious Signal: Block the Broadcast',
        groupName: 'Homefront Operation Site - Combat Site',
        signal: '100.0%'
      }
    ]);

  });
  
  it('parses factional warfare anomalies', () => {
    const text =
      'ABC-531\tCosmic Anomaly\tFactional Warfare Site - Combat Site\tMinmatar Large ADV-1\t100.0%\t68.93 AU'
    expect(parseSignaturePaste(text)).toEqual([
      {
        sigId: 'ABC-531',
        name: 'Minmatar Large ADV-1',
        groupName: 'Factional Warfare Site - Combat Site',
        signal: '100.0%'
      }
    ]);
  });
});
