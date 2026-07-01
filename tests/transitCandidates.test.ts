import { describe, expect, it } from 'vitest';
import { transitCandidates } from '@/components/map/TransitSignaturePrompt';
import type { MapSignature } from '@/types';

function sig(overrides: Partial<MapSignature>): MapSignature {
  return {
    id: '1',
    mapSystemId: 'src',
    mapConnectionId: null,
    sigId: 'ABC',
    groupKey: 'wormhole',
    classKind: null,
    activityOverride: null,
    typeId: null,
    eolStage: 'none',
    wormholeCode: null,
    name: null,
    description: null,
    expiresAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const base = {
  sourceMapSystemId: 'src',
  destClass: 'C3',
};

describe('transitCandidates', () => {
  it('includes a sig whose WH type leads to the destination class', () => {
    const s = sig({ id: 'm', typeId: 100 });
    const out = transitCandidates({
      ...base,
      signatures: [s],
      targetClassByTypeId: new Map([[100, 'C3']]),
    });
    expect(out.map((c) => c.id)).toEqual(['m']);
  });

  it('excludes a sig whose WH type leads to a different class', () => {
    const s = sig({ id: 'x', typeId: 200 });
    const out = transitCandidates({
      ...base,
      signatures: [s],
      targetClassByTypeId: new Map([[200, 'C5']]),
    });
    expect(out).toEqual([]);
  });

  it('includes a K162 (null targetClass) — leads anywhere', () => {
    const s = sig({ id: 'k', typeId: 300 });
    const out = transitCandidates({
      ...base,
      signatures: [s],
      targetClassByTypeId: new Map([[300, null]]),
    });
    expect(out.map((c) => c.id)).toEqual(['k']);
  });

  it('includes a sig with no type set yet', () => {
    const s = sig({ id: 'untyped', typeId: null });
    const out = transitCandidates({
      ...base,
      signatures: [s],
      targetClassByTypeId: new Map(),
    });
    expect(out.map((c) => c.id)).toEqual(['untyped']);
  });

  it('excludes non-wormhole groups', () => {
    const s = sig({ id: 'gas', groupKey: 'gas', typeId: null });
    const out = transitCandidates({
      ...base,
      signatures: [s],
      targetClassByTypeId: new Map(),
    });
    expect(out).toEqual([]);
  });

  it('excludes a sig already bound to a connection', () => {
    const s = sig({ id: 'bound', typeId: 100, mapConnectionId: 'conn-1' });
    const out = transitCandidates({
      ...base,
      signatures: [s],
      targetClassByTypeId: new Map([[100, 'C3']]),
    });
    expect(out).toEqual([]);
  });

  it('excludes a sig bound to a different hole', () => {
    const s = sig({ id: 'other-hole', typeId: 100, mapConnectionId: 'conn-other' });
    const out = transitCandidates({
      ...base,
      signatures: [s],
      targetClassByTypeId: new Map([[100, 'C3']]),
    });
    expect(out).toEqual([]);
  });

  it('excludes sigs from a different source system', () => {
    const s = sig({ id: 'elsewhere', mapSystemId: 'other', typeId: null });
    const out = transitCandidates({
      ...base,
      signatures: [s],
      targetClassByTypeId: new Map(),
    });
    expect(out).toEqual([]);
  });
});
