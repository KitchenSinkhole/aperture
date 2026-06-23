import { describe, expect, it } from 'vitest';
import { applyEvent } from '@/lib/map/applyEvent';
import type { MapConnectionEdge, MapSignature, MapViewData } from '@/types';
import type { MapEventPayload } from '@/lib/realtime/protocol';

function connection(id: string): MapConnectionEdge {
  return {
    id,
    source: '1',
    target: '2',
    scope: 'wh',
    massStatus: 'fresh',
    jumpMassClass: null,
    eolStage: 'none',
    preserveMass: false,
    isRolling: false,
    isStatic: false,
    eolAt: null,
    createdAt: '2026-06-07T00:00:00.000Z',
  };
}

function signature(id: string, mapConnectionId: string | null): MapSignature {
  return {
    id,
    mapSystemId: '1',
    mapConnectionId,
    sigId: 'ABC',
    groupKey: null,
    typeId: null,
    wormholeCode: null,
    name: null,
    description: null,
    expiresAt: '2026-06-08T00:00:00.000Z',
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
  };
}

function viewData(overrides: Partial<MapViewData> = {}): MapViewData {
  return {
    map: {
      id: '1',
      name: 'Test',
      scope: 'wh',
      type: 'corp',
      tagScheme: 'none',
      homeMapSystemId: null,
    },
    systems: [],
    connections: [],
    signatures: [],
    notes: [],
    presence: [],
    ...overrides,
  };
}

describe('applyEvent — connection.delete cascade', () => {
  it('removes the connection and any signature linked to it, mirroring the DB cascade', () => {
    const state = viewData({
      connections: [connection('100')],
      signatures: [signature('500', '100'), signature('501', null)],
    });

    const event: MapEventPayload = { kind: 'connection.delete', eventId: 1, id: '100' };
    const next = applyEvent(state, event);

    expect(next.connections).toHaveLength(0);
    // The signature linked to connection 100 is dropped; the unlinked one stays.
    expect(next.signatures.map((s) => s.id)).toEqual(['501']);
  });

  it('leaves signatures linked to a different connection untouched', () => {
    const state = viewData({
      connections: [connection('100'), connection('200')],
      signatures: [signature('500', '100'), signature('502', '200')],
    });

    const event: MapEventPayload = { kind: 'connection.delete', eventId: 2, id: '100' };
    const next = applyEvent(state, event);

    expect(next.connections.map((c) => c.id)).toEqual(['200']);
    expect(next.signatures.map((s) => s.id)).toEqual(['502']);
  });
});
