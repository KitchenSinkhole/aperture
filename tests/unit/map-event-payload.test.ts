import { describe, expect, it } from 'vitest';
import { MAP_EVENT_KINDS, mapEventPayloadSchema } from '@/lib/realtime/protocol';

// Pure (no DB) checks on the map-event payload contract.
describe('mapEventPayloadSchema', () => {
  it('covers all 12 seeded event kinds as discriminators', () => {
    const optionKinds = mapEventPayloadSchema.options.map((o) => o.shape.kind.value);
    expect(new Set(optionKinds)).toEqual(new Set(MAP_EVENT_KINDS));
  });

  it('accepts a full system.added body', () => {
    const payload = {
      kind: 'system.added',
      eventId: 42,
      id: '7',
      systemId: 30000142,
      name: 'Jita',
      alias: null,
      tag: null,
      intelNotes: null,
      status: 'occupied',
      security: '0.9',
      trueSec: 0.9,
      effect: null,
      regionName: 'The Forge',
      constellationName: 'Kimotoro',
      statics: [],
      tradeHub: null,
      locked: false,
      rallyAt: null,
      positionX: 10,
      positionY: 20,
    };
    expect(mapEventPayloadSchema.parse(payload)).toMatchObject({ kind: 'system.added', eventId: 42 });
  });

  it('does not carry signatures on system.added (they hydrate via a separate fetch)', () => {
    const parsed = mapEventPayloadSchema.parse({
      kind: 'system.added',
      eventId: 43,
      id: '7',
      systemId: 30000142,
      name: 'Jita',
      alias: null,
      tag: null,
      intelNotes: null,
      status: 'occupied',
      security: '0.9',
      trueSec: 0.9,
      effect: null,
      regionName: 'The Forge',
      constellationName: 'Kimotoro',
      statics: [],
      tradeHub: null,
      locked: false,
      rallyAt: null,
      positionX: 10,
      positionY: 20,
      // A stray signatures field must be stripped, not preserved — the contract
      // is that sigs never ride the event (that breached the 8 KB pg_notify cap).
      signatures: [{ id: '1', sigId: 'ABC' }],
    });
    expect('signatures' in parsed).toBe(false);
  });

  it('accepts a partial system.updated patch', () => {
    const parsed = mapEventPayloadSchema.parse({
      kind: 'system.updated',
      eventId: 1,
      id: '7',
      status: 'hostile',
    });
    expect(parsed).toEqual({ kind: 'system.updated', eventId: 1, id: '7', status: 'hostile' });
  });

  it('rejects a payload missing eventId', () => {
    expect(() =>
      mapEventPayloadSchema.parse({ kind: 'connection.delete', id: '3' }),
    ).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() => mapEventPayloadSchema.parse({ kind: 'system.exploded', eventId: 1 })).toThrow();
  });
});
