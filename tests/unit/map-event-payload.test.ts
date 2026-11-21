import { describe, expect, it } from 'vitest';
import { MAP_EVENT_KINDS, mapEventPayloadSchema } from '@/lib/realtime/protocol';

// Pure (no DB) checks on the map-event payload contract.
describe('mapEventPayloadSchema', () => {
  it('covers every seeded event kind as a discriminator', () => {
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
      staticTypeIds: [],
      tradeHub: null,
      locked: false,
      lockedByCharacterId: null,
      lockedByName: null,
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
      staticTypeIds: [],
      tradeHub: null,
      locked: false,
      lockedByCharacterId: null,
      lockedByName: null,
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

  it('includes the six user API kinds', () => {
    for (const kind of [
      'api.enabled',
      'api.disabled',
      'api.scopes_changed',
      'api.token_created',
      'api.token_revoked',
      'api.token_suspended',
    ]) {
      expect(MAP_EVENT_KINDS).toContain(kind);
    }
  });

  it('accepts each user API payload', () => {
    const payloads = [
      { kind: 'api.enabled', eventId: 1, scopes: ['map', 'signatures'] },
      { kind: 'api.disabled', eventId: 2 },
      { kind: 'api.scopes_changed', eventId: 3, added: ['kills'], removed: ['pilots'] },
      {
        kind: 'api.token_created',
        eventId: 4,
        tokenId: '12',
        label: 'chain bot',
        scopes: ['map'],
        expiresAt: '2027-02-19T00:00:00.000Z',
      },
      {
        kind: 'api.token_revoked',
        eventId: 5,
        tokenId: '12',
        label: 'chain bot',
        reason: 'manager',
      },
      {
        kind: 'api.token_suspended',
        eventId: 6,
        tokenId: '12',
        label: 'chain bot',
        until: '2026-11-21T14:30:00.000Z',
        strike: 1,
      },
    ];
    for (const payload of payloads) {
      expect(mapEventPayloadSchema.parse(payload)).toEqual(payload);
    }
  });

  it('rejects an api scope outside the api_scope enum', () => {
    expect(() =>
      mapEventPayloadSchema.parse({ kind: 'api.enabled', eventId: 1, scopes: ['wallet'] }),
    ).toThrow();
  });

  it('strips any raw token from a token event', () => {
    const parsed = mapEventPayloadSchema.parse({
      kind: 'api.token_created',
      eventId: 7,
      tokenId: '12',
      label: 'chain bot',
      scopes: ['map'],
      expiresAt: null,
      token: 'apu_secret',
      tokenHash: 'abc',
      tokenPrefix: 'secret',
    });
    expect(parsed).not.toHaveProperty('token');
    expect(parsed).not.toHaveProperty('tokenHash');
    expect(parsed).not.toHaveProperty('tokenPrefix');
  });

  it('rejects an unknown kind', () => {
    expect(() => mapEventPayloadSchema.parse({ kind: 'system.exploded', eventId: 1 })).toThrow();
  });
});
