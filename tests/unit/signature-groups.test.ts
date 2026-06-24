import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_GROUP_CATALOG,
  labelForSignatureGroupKey,
  signatureGroupKeyFromScannerName,
} from '@/lib/map/signatureGroups';

describe('signatureGroupKeyFromScannerName', () => {
  it('maps every scanner Group label to its key', () => {
    for (const g of SIGNATURE_GROUP_CATALOG) {
      for (const name of g.scannerNames) {
        expect(signatureGroupKeyFromScannerName(name)).toBe(g.key);
      }
    }
  });

  it('maps Combat aliases (Factional Warfare, Homefront) to combat', () => {
    expect(
      signatureGroupKeyFromScannerName('Factional Warfare Site - Combat Site'),
    ).toBe('combat');
    expect(
      signatureGroupKeyFromScannerName('Homefront Operation Site - Combat Site'),
    ).toBe('combat');
  });

  it('is case-insensitive', () => {
    expect(signatureGroupKeyFromScannerName('combat site')).toBe('combat');
    expect(signatureGroupKeyFromScannerName('WORMHOLE')).toBe('wormhole');
  });

  it('matches by prefix when the cell carries an unexpected suffix', () => {
    expect(signatureGroupKeyFromScannerName('Combat Site (Lookout)')).toBe('combat');
  });

  it('returns null for empty or unknown input', () => {
    expect(signatureGroupKeyFromScannerName(null)).toBeNull();
    expect(signatureGroupKeyFromScannerName('')).toBeNull();
    expect(signatureGroupKeyFromScannerName('Cosmic Anomaly')).toBeNull();
  });
});

describe('labelForSignatureGroupKey', () => {
  it('returns the catalog label for each key', () => {
    for (const g of SIGNATURE_GROUP_CATALOG) {
      expect(labelForSignatureGroupKey(g.key)).toBe(g.label);
    }
  });

  it('returns null for null/undefined input', () => {
    expect(labelForSignatureGroupKey(null)).toBeNull();
    expect(labelForSignatureGroupKey(undefined)).toBeNull();
  });
});
