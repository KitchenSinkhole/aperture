import { describe, it, expect } from 'vitest';
import { applyEvent } from '@/lib/map/applyEvent';
import type { MapConnectionEdge, MapSignature, MapSystemNode, MapViewData } from '@/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeState = (overrides?: Partial<MapViewData>): MapViewData => ({
  map: { id: '1', name: 'Test Map', scope: 'wh', type: 'private', tagScheme: 'none', homeMapSystemId: null },
  systems: [],
  connections: [],
  signatures: [],
  notes: [],
  presence: [],
  ...overrides,
});

const sys1: MapSystemNode = {
  id: '10',
  systemId: 30000142,
  name: 'Jita',
  alias: null,
  tag: null,
  intelNotes: null,
  status: 'unknown',
  security: '0.9',
  trueSec: 0.9,
  effect: null,
  regionName: 'The Forge',
  constellationName: 'Kimotoro',
  statics: [],
  tradeHub: null,
  locked: false,
  rallyAt: null,
  positionX: 100,
  positionY: 200,
};

const sys2: MapSystemNode = { ...sys1, id: '11', systemId: 30000143, name: 'Perimeter' };

const conn1: MapConnectionEdge = {
  id: '20',
  source: '10',
  target: '11',
  scope: 'wh',
  massStatus: 'fresh',
  jumpMassClass: null,
  eolStage: 'none',
  preserveMass: false,
  isStatic: false,
  isRolling: false,
  eolAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// system.added
// ---------------------------------------------------------------------------

describe('applyEvent — system.added', () => {
  it('appends a new system to an empty map', () => {
    const next = applyEvent(makeState(), { kind: 'system.added', eventId: 1, ...sys1 });
    expect(next.systems).toHaveLength(1);
    expect(next.systems[0]).toMatchObject({ id: '10', name: 'Jita' });
  });

  it('replaces an existing system with the same id (re-activation upsert)', () => {
    const state = makeState({ systems: [sys1] });
    const updated = { ...sys1, alias: 'Home', positionX: 999 };
    const next = applyEvent(state, { kind: 'system.added', eventId: 2, ...updated });
    expect(next.systems).toHaveLength(1);
    expect(next.systems[0]).toMatchObject({ alias: 'Home', positionX: 999 });
  });

  it('does not mutate the original state', () => {
    const state = makeState();
    applyEvent(state, { kind: 'system.added', eventId: 3, ...sys1 });
    expect(state.systems).toHaveLength(0);
  });

  it('leaves signatures untouched — they hydrate via fetch, not the event', () => {
    const sig: MapSignature = {
      id: '30',
      mapSystemId: '10',
      mapConnectionId: null,
      sigId: 'ABC-123',
      groupKey: null,
      typeId: null,
      wormholeCode: null,
      name: null,
      description: null,
      expiresAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const state = makeState({ signatures: [sig] });
    const next = applyEvent(state, { kind: 'system.added', eventId: 5, ...sys1 });
    expect(next.signatures).toEqual([sig]);
  });
});

// ---------------------------------------------------------------------------
// system.removed
// ---------------------------------------------------------------------------

describe('applyEvent — system.removed', () => {
  it('removes a system by id', () => {
    const state = makeState({ systems: [sys1, sys2] });
    const next = applyEvent(state, { kind: 'system.removed', eventId: 4, id: '10' });
    expect(next.systems).toHaveLength(1);
    expect(next.systems[0]!.id).toBe('11');
  });

  it('is a no-op for an id not in the canvas', () => {
    const state = makeState({ systems: [sys1] });
    const next = applyEvent(state, { kind: 'system.removed', eventId: 5, id: '999' });
    expect(next.systems).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// system.updated
// ---------------------------------------------------------------------------

describe('applyEvent — system.updated', () => {
  it('merges a partial patch (only provided fields change)', () => {
    const state = makeState({ systems: [sys1] });
    const next = applyEvent(state, {
      kind: 'system.updated',
      eventId: 6,
      id: '10',
      status: 'hostile',
      locked: true,
    });
    expect(next.systems[0]).toMatchObject({ status: 'hostile', locked: true, name: 'Jita' });
  });

  it('updates position fields', () => {
    const state = makeState({ systems: [sys1] });
    const next = applyEvent(state, {
      kind: 'system.updated',
      eventId: 7,
      id: '10',
      positionX: 500,
      positionY: 600,
    });
    expect(next.systems[0]).toMatchObject({ positionX: 500, positionY: 600 });
  });

  it('applies intelNotes and rallyAt', () => {
    const state = makeState({ systems: [sys1] });
    const next = applyEvent(state, {
      kind: 'system.updated',
      eventId: 8,
      id: '10',
      intelNotes: 'enemy camp',
      rallyAt: '2026-01-01T00:00:00Z',
    });
    expect(next.systems[0]!.intelNotes).toBe('enemy camp');
    expect(next.systems[0]!.rallyAt).toBe('2026-01-01T00:00:00Z');
  });

  it('is a no-op for an unknown id', () => {
    const state = makeState({ systems: [sys1] });
    const next = applyEvent(state, {
      kind: 'system.updated',
      eventId: 9,
      id: '999',
      status: 'hostile',
    });
    expect(next.systems[0]!.status).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// connection.create
// ---------------------------------------------------------------------------

describe('applyEvent — connection.create', () => {
  it('appends a new connection', () => {
    const state = makeState();
    const next = applyEvent(state, { kind: 'connection.create', eventId: 10, ...conn1 });
    expect(next.connections).toHaveLength(1);
    expect(next.connections[0]).toMatchObject({ id: '20', scope: 'wh' });
  });

  it('upserts when a connection with the same id already exists (no duplicate edge)', () => {
    const state = makeState({ connections: [conn1] });
    const updated = { ...conn1, scope: 'stargate' as const };
    const next = applyEvent(state, { kind: 'connection.create', eventId: 10, ...updated });
    expect(next.connections).toHaveLength(1);
    expect(next.connections[0]).toMatchObject({ id: '20', scope: 'stargate' });
  });
});

// ---------------------------------------------------------------------------
// connection.update
// ---------------------------------------------------------------------------

describe('applyEvent — connection.update', () => {
  it('merges a partial patch including eolAt', () => {
    const state = makeState({ connections: [conn1] });
    const next = applyEvent(state, {
      kind: 'connection.update',
      eventId: 11,
      id: '20',
      massStatus: 'critical',
      eolStage: 'critical',
      eolAt: '2026-01-01T00:00:00Z',
    });
    const c = next.connections[0]!;
    expect(c.massStatus).toBe('critical');
    expect(c.eolStage).toBe('critical');
    expect(c.eolAt).toBe('2026-01-01T00:00:00Z');
  });

  it('is a no-op for an unknown id', () => {
    const state = makeState({ connections: [conn1] });
    const next = applyEvent(state, {
      kind: 'connection.update',
      eventId: 12,
      id: '999',
      massStatus: 'reduced',
    });
    expect(next.connections[0]!.massStatus).toBe('fresh');
  });
});

// ---------------------------------------------------------------------------
// connection.delete
// ---------------------------------------------------------------------------

describe('applyEvent — connection.delete', () => {
  it('removes a connection by id', () => {
    const state = makeState({ connections: [conn1] });
    const next = applyEvent(state, { kind: 'connection.delete', eventId: 13, id: '20' });
    expect(next.connections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// map.update
// ---------------------------------------------------------------------------

describe('applyEvent — map.update', () => {
  it('updates the map name when provided', () => {
    const state = makeState();
    const next = applyEvent(state, {
      kind: 'map.update',
      eventId: 14,
      id: '1',
      name: 'Renamed Map',
    });
    expect(next.map.name).toBe('Renamed Map');
  });

  it('is a no-op when name is absent', () => {
    const state = makeState();
    const next = applyEvent(state, {
      kind: 'map.update',
      eventId: 15,
      id: '1',
      logActivity: true,
    });
    expect(next.map.name).toBe('Test Map');
    expect(next).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// signature.*
// ---------------------------------------------------------------------------

const sig1: MapSignature = {
  id: '30',
  mapSystemId: '10',
  mapConnectionId: null,
  sigId: 'ABC',
  groupKey: null,
  typeId: null,
  wormholeCode: null,
  name: null,
  description: null,
  expiresAt: '2026-12-31T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('applyEvent — signature.create', () => {
  it('appends a new signature', () => {
    const state = makeState({ systems: [sys1] });
    const next = applyEvent(state, { kind: 'signature.create', eventId: 20, ...sig1 });
    expect(next.signatures).toHaveLength(1);
    expect(next.signatures[0]).toMatchObject({ id: '30', sigId: 'ABC' });
  });

  it('upserts when a signature with the same id already exists', () => {
    const state = makeState({ systems: [sys1], signatures: [sig1] });
    const updated = { ...sig1, name: 'Renamed' };
    const next = applyEvent(state, { kind: 'signature.create', eventId: 21, ...updated });
    expect(next.signatures).toHaveLength(1);
    expect(next.signatures[0]!.name).toBe('Renamed');
  });
});

describe('applyEvent — signature.update', () => {
  it('merges only the provided fields', () => {
    const state = makeState({ systems: [sys1], signatures: [sig1] });
    const next = applyEvent(state, {
      kind: 'signature.update',
      eventId: 22,
      id: '30',
      name: 'B274',
      groupKey: 'wormhole',
    });
    expect(next.signatures[0]).toMatchObject({ name: 'B274', groupKey: 'wormhole', sigId: 'ABC' });
  });

  it('is a no-op for an unknown id', () => {
    const state = makeState({ systems: [sys1], signatures: [sig1] });
    const next = applyEvent(state, {
      kind: 'signature.update',
      eventId: 23,
      id: '999',
      name: 'X',
    });
    expect(next.signatures[0]!.name).toBeNull();
  });

  it('accepts a null patch value to clear a field', () => {
    const state = makeState({ systems: [sys1], signatures: [{ ...sig1, name: 'Old' }] });
    const next = applyEvent(state, {
      kind: 'signature.update',
      eventId: 24,
      id: '30',
      name: null,
    });
    expect(next.signatures[0]!.name).toBeNull();
  });
});

describe('applyEvent — signature.delete', () => {
  it('removes a signature by id', () => {
    const state = makeState({ systems: [sys1], signatures: [sig1] });
    const next = applyEvent(state, { kind: 'signature.delete', eventId: 25, id: '30' });
    expect(next.signatures).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// No-op events
// ---------------------------------------------------------------------------

describe('applyEvent — no-op events', () => {
  const noopKinds = [
    { kind: 'map.create' as const, eventId: 30, id: '2', name: 'New Map', scope: 'wh' as const, type: 'private' as const, icon: null },
    { kind: 'map.delete' as const, eventId: 31, id: '1' },
  ];

  for (const payload of noopKinds) {
    it(`returns the same state reference for ${payload.kind}`, () => {
      const state = makeState({ systems: [sys1], connections: [conn1] });
      const next = applyEvent(state, payload);
      expect(next).toBe(state);
    });
  }
});
