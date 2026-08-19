import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_GROUP_CATALOG,
  isScannerGroupName,
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

  it('maps Combat aliases (Factional Warfare, Homefront, Insurgency) to combat', () => {
    expect(
      signatureGroupKeyFromScannerName('Factional Warfare Site - Combat Site'),
    ).toBe('combat');
    expect(
      signatureGroupKeyFromScannerName('Homefront Operation Site - Combat Site'),
    ).toBe('combat');
    expect(
      signatureGroupKeyFromScannerName('Insurgency Site - Combat Site'),
    ).toBe('combat');
  });

  it('is case-insensitive', () => {
    expect(signatureGroupKeyFromScannerName('combat site')).toBe('combat');
    expect(signatureGroupKeyFromScannerName('WORMHOLE')).toBe('wormhole');
  });

  it('matches a cell that carries an unexpected suffix', () => {
    expect(signatureGroupKeyFromScannerName('Combat Site (Lookout)')).toBe('combat');
  });

  it('matches a qualifier EVE prepends without a catalog entry', () => {
    expect(signatureGroupKeyFromScannerName('Invasion Site - Combat Site')).toBe('combat');
    expect(signatureGroupKeyFromScannerName('Insurgency Site - Relic Site')).toBe('relic');
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

describe('isScannerGroupName', () => {
  it('is true for every catalog scanner label, case-insensitively', () => {
    for (const g of SIGNATURE_GROUP_CATALOG) {
      for (const name of g.scannerNames) {
        expect(isScannerGroupName(name)).toBe(true);
        expect(isScannerGroupName(name.toUpperCase())).toBe(true);
      }
    }
  });

  it('is false for site names that embed a group word', () => {
    expect(isScannerGroupName('Unstable Wormhole')).toBe(false);
    expect(isScannerGroupName('Wormhole in Rock Circle')).toBe(false);
    expect(isScannerGroupName('Rock Formation and Wormhole')).toBe(false);
    expect(isScannerGroupName('Combat Site (Lookout)')).toBe(false);
  });

  it('is false for empty input', () => {
    expect(isScannerGroupName(null)).toBe(false);
    expect(isScannerGroupName(undefined)).toBe(false);
    expect(isScannerGroupName('  ')).toBe(false);
  });
});
