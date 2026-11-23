import { describe, expect, it } from 'vitest';
import { compareSignaturesExperimental } from '@/lib/map/signatureTableSort';
import type { MapSignature } from '@/types';

function sig(partial: Partial<MapSignature> & Pick<MapSignature, 'id' | 'sigId'>): MapSignature {
  return {
    mapSystemId: 'sys',
    mapConnectionId: null,
    groupKey: null,
    classKind: null,
    activityOverride: null,
    typeId: null,
    eolStage: 'none',
    wormholeCode: null,
    name: null,
    description: null,
    expiresAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('compareSignaturesExperimental', () => {
  it('orders unscanned before scanned then group', () => {
    const a = sig({
      id: '1',
      sigId: 'AAA',
      groupKey: 'combat',
      name: 'Site',
    });
    const b = sig({
      id: '2',
      sigId: 'BBB',
      groupKey: 'combat',
    });
  expect(compareSignaturesExperimental(b, a)).toBeLessThan(0);

    const wh = sig({
      id: '3',
      sigId: 'CCC',
      groupKey: 'wormhole',
      typeId: 1,
      mapConnectionId: 'conn',
    });
    expect(compareSignaturesExperimental(b, wh)).toBeLessThan(0);
  });
});
