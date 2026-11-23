import { describe, expect, it } from 'vitest';
import {
  describeMapEvent,
  formatHistoryMessage,
  formatRallyMessage,
  isEolEstimateEvent,
  isRallySetEvent,
  type WebhookEventContext,
} from '@/lib/webhooks/formatters';
import type { MapEventPayload } from '@/lib/realtime/protocol';

/**
 * Unit coverage for the pure formatters. The dispatcher tests
 * (DB-gated) cover end-to-end POST behaviour; here we just pin the rendered
 * Discord payload shape for each `MapEventPayload` variant.
 */

const baseCtx: WebhookEventContext = {
  mapName: 'Test Map',
  characterName: 'Pilot Foo',
  systemName: 'Jita',
  sourceSystemName: 'Jita',
  targetSystemName: 'Amarr',
};

describe('isRallySetEvent', () => {
  it('returns true for a system.updated with non-null rallyAt', () => {
    const event: MapEventPayload = {
      kind: 'system.updated',
      eventId: 1,
      id: '42',
      rallyAt: '2026-05-27T12:00:00.000Z',
    };
    expect(isRallySetEvent(event)).toBe(true);
  });

  it('returns false for rally cleared', () => {
    const event: MapEventPayload = {
      kind: 'system.updated',
      eventId: 1,
      id: '42',
      rallyAt: null,
    };
    expect(isRallySetEvent(event)).toBe(false);
  });

  it('returns false for non-system-updated events', () => {
    const event: MapEventPayload = {
      kind: 'system.removed',
      eventId: 1,
      id: '42',
    };
    expect(isRallySetEvent(event)).toBe(false);
  });
});

describe('formatHistoryMessage', () => {
  it('renders system.added with the system name from the payload', () => {
    const event: MapEventPayload = {
      kind: 'system.added',
      eventId: 1,
      id: '42',
      systemId: 30000142,
      name: 'Jita',
      alias: null,
      tag: null,
      intelNotes: null,
      status: 'unknown',
      security: '0.9',
      trueSec: 0.95,
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
      positionX: 0,
      positionY: 0,
    };
    const payload = formatHistoryMessage(event, baseCtx);
    expect(payload?.content).toBe('**Test Map**: Pilot Foo added **Jita** to the map.');
  });

  it('renders a rally-set update with the rally phrasing', () => {
    const event: MapEventPayload = {
      kind: 'system.updated',
      eventId: 2,
      id: '42',
      rallyAt: '2026-05-27T12:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo set a rally point in **Jita**.',
    );
  });

  it('renders a rally-clear update with the cleared phrasing', () => {
    const event: MapEventPayload = {
      kind: 'system.updated',
      eventId: 3,
      id: '42',
      rallyAt: null,
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo cleared the rally point in **Jita**.',
    );
  });

  it('falls back to "Aperture" when no character is attached', () => {
    const event: MapEventPayload = {
      kind: 'system.removed',
      eventId: 4,
      id: '42',
    };
    const payload = formatHistoryMessage(event, { ...baseCtx, characterName: null });
    expect(payload?.content).toBe('**Test Map**: Aperture removed **Jita** from the map.');
  });

  it('names no actor while Blackout hides it', () => {
    const event: MapEventPayload = {
      kind: 'system.removed',
      eventId: 4,
      id: '42',
    };
    const payload = formatHistoryMessage(event, { ...baseCtx, hideActor: true });
    expect(payload?.content).toBe('**Test Map**: Removed **Jita** from the map.');
    expect(payload?.content).not.toContain('Pilot Foo');
    expect(payload?.content).not.toContain('Aperture');
  });

  it('returns null for a position-only update (nothing worth saying)', () => {
    const event: MapEventPayload = {
      kind: 'system.updated',
      eventId: 5,
      id: '42',
      positionX: 100,
      positionY: 200,
    };
    expect(formatHistoryMessage(event, baseCtx)).toBeNull();
  });

  it('renders connection.create with both endpoint names', () => {
    const event: MapEventPayload = {
      kind: 'connection.create',
      eventId: 6,
      id: '7',
      source: '1',
      target: '2',
      scope: 'wh',
      massStatus: 'fresh',
      jumpMassClass: 'l',
      eolStage: 'none',
      preserveMass: false,
      isRolling: false,
      isStatic: false,
      sourceBubbled: false,
      targetBubbled: false,
      eolAt: null,
      eolSource: null,
      createdAt: '2026-05-27T12:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo connected **Jita** ↔ **Amarr**.',
    );
  });

  it('renders connection.update EOL (4h) flip', () => {
    const event: MapEventPayload = {
      kind: 'connection.update',
      eventId: 7,
      id: '7',
      source: '1',
      target: '2',
      eolStage: 'eol',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo updated **Jita** ↔ **Amarr** (EOL → ~4h).',
    );
  });

  it('describes an auto-EOL mark as an age estimate, distinct from a scout EOL', () => {
    const estimate: MapEventPayload = {
      kind: 'connection.update',
      eventId: 7,
      id: '7',
      source: '1',
      target: '2',
      eolStage: 'eol',
      eolAt: '2026-11-23T12:00:00.000Z',
      eolSource: 'auto',
    };
    const observed: MapEventPayload = { ...estimate, eolSource: 'observed' };
    expect(describeMapEvent(estimate, { ...baseCtx, characterName: null })).toBe(
      'updated **Jita** ↔ **Amarr** (EOL estimated from age → ~4h)',
    );
    expect(describeMapEvent(observed, baseCtx)).toBe('updated **Jita** ↔ **Amarr** (EOL → ~4h)');
    expect(isEolEstimateEvent(estimate)).toBe(true);
    expect(isEolEstimateEvent(observed)).toBe(false);
  });

  it('renders connection.update critical EOL (1h) flip', () => {
    const event: MapEventPayload = {
      kind: 'connection.update',
      eventId: 7,
      id: '7',
      source: '1',
      target: '2',
      eolStage: 'critical',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo updated **Jita** ↔ **Amarr** (EOL → critical (~1h)).',
    );
  });

  it('renders connection.update jump-mass-class change with a friendly size label', () => {
    const event: MapEventPayload = {
      kind: 'connection.update',
      eventId: 7,
      id: '7',
      source: '1',
      target: '2',
      jumpMassClass: 'l',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo updated **Jita** ↔ **Amarr** (max ship size → large).',
    );
  });

  it('renders connection.update listing every changed field', () => {
    const event: MapEventPayload = {
      kind: 'connection.update',
      eventId: 7,
      id: '7',
      source: '1',
      target: '2',
      massStatus: 'critical',
      isRolling: true,
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo updated **Jita** ↔ **Amarr** (mass → `critical`, rolling started).',
    );
  });

  it('returns null for a connection.update carrying no recognized change', () => {
    const event: MapEventPayload = {
      kind: 'connection.update',
      eventId: 7,
      id: '7',
      source: '1',
      target: '2',
    };
    expect(formatHistoryMessage(event, baseCtx)).toBeNull();
  });

  it('renders signature.create with the sig id', () => {
    const event: MapEventPayload = {
      kind: 'signature.create',
      eventId: 8,
      id: '99',
      mapSystemId: '42',
      mapConnectionId: null,
      sigId: 'ABC-123',
      groupKey: null,
      classKind: null,
      activityOverride: null,
      typeId: null,
      eolStage: 'none',
      wormholeCode: null,
      name: null,
      description: null,
      expiresAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo added signature `ABC-123` in **Jita**.',
    );
  });

  it('renders signature.update naming the changed wormhole type', () => {
    const event: MapEventPayload = {
      kind: 'signature.update',
      eventId: 9,
      id: '99',
      mapSystemId: '42',
      sigId: 'AUQ',
      typeId: 31000,
      wormholeCode: 'B274',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo updated signature `AUQ` in **Jita** (type → `B274`).',
    );
  });

  it('renders signature.update with no recognized field change as a bare update', () => {
    const event: MapEventPayload = {
      kind: 'signature.update',
      eventId: 9,
      id: '99',
      mapSystemId: '42',
      sigId: 'AUQ',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo updated signature `AUQ` in **Jita**.',
    );
  });

  it('suppresses the housekeeping name-clear the client folds into a type change', () => {
    const event: MapEventPayload = {
      kind: 'signature.update',
      eventId: 9,
      id: '99',
      mapSystemId: '42',
      sigId: 'AUQ',
      typeId: 31000,
      wormholeCode: 'B274',
      // The client sends `name: null` alongside a WH-type pick (code-mirror reset);
      // the audit should report the type, not a spurious "name cleared".
      name: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo updated signature `AUQ` in **Jita** (type → `B274`).',
    );
  });

  it('names the destination when a signature is unlinked from its connection', () => {
    const event: MapEventPayload = {
      kind: 'signature.update',
      eventId: 9,
      id: '99',
      mapSystemId: '42',
      sigId: 'AUQ',
      mapConnectionId: null,
      leadsToMapSystemId: '7', // resolves to baseCtx.targetSystemName = 'Amarr'
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo updated signature `AUQ` in **Jita** (unlinked from **Amarr**).',
    );
  });

  it('summarizes a created wormhole signature with its code and destination', () => {
    const event: MapEventPayload = {
      kind: 'signature.create',
      eventId: 8,
      id: '99',
      mapSystemId: '42',
      mapConnectionId: '5',
      sigId: 'LBS-432',
      groupKey: 'wormhole',
      classKind: 'signature',
      activityOverride: null,
      typeId: 31000,
      eolStage: 'none',
      wormholeCode: 'C008',
      name: null,
      description: null,
      expiresAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      leadsToMapSystemId: '7', // → 'Amarr'
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo added signature `LBS-432` in **Jita** (wormhole `C008`, leads to **Amarr**).',
    );
  });

  it('labels a created cosmic signature by its scanner group', () => {
    const event: MapEventPayload = {
      kind: 'signature.create',
      eventId: 8,
      id: '99',
      mapSystemId: '42',
      mapConnectionId: null,
      sigId: 'XYZ-111',
      groupKey: 'relic',
      classKind: 'signature',
      activityOverride: null,
      typeId: null,
      eolStage: 'none',
      wormholeCode: null,
      name: 'Forgotten Frontier',
      description: null,
      expiresAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      leadsToMapSystemId: null,
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo added signature `XYZ-111` in **Jita** (relic site).',
    );
  });

  it('renders connection.delete with both endpoint names (carried in the payload)', () => {
    const event: MapEventPayload = {
      kind: 'connection.delete',
      eventId: 10,
      id: '7',
      source: '1',
      target: '2',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo removed the connection **Jita** ↔ **Amarr**.',
    );
  });

  it('renders signature.delete with the sig id (carried in the payload)', () => {
    const event: MapEventPayload = {
      kind: 'signature.delete',
      eventId: 11,
      id: '99',
      mapSystemId: '42',
      sigId: 'ABC-123',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map**: Pilot Foo removed signature `ABC-123` from **Jita**.',
    );
  });
});

describe('describeMapEvent — user API', () => {
  const ownerCtx = { ...baseCtx, tokenOwnerName: 'Pilot Bar' };
  const cases: Array<[MapEventPayload, string | null, WebhookEventContext?]> = [
    [
      { kind: 'api.enabled', eventId: 1, scopes: ['map', 'pilots'] },
      'enabled the user API (scopes `map`, `pilots`)',
    ],
    [{ kind: 'api.enabled', eventId: 2, scopes: [] }, 'enabled the user API (no scopes)'],
    [{ kind: 'api.disabled', eventId: 3 }, 'disabled the user API'],
    [
      { kind: 'api.scopes_changed', eventId: 4, added: ['kills', 'notes'], removed: ['pilots'] },
      'changed the user API scopes (added `kills`, `notes`; removed `pilots`)',
    ],
    [
      { kind: 'api.scopes_changed', eventId: 5, added: [], removed: ['mass_log'] },
      'changed the user API scopes (removed `mass_log`)',
    ],
    [{ kind: 'api.scopes_changed', eventId: 6, added: [], removed: [] }, null],
    [
      {
        kind: 'api.token_created',
        eventId: 7,
        tokenId: '12',
        label: 'chain bot',
        scopes: ['map', 'signatures'],
        expiresAt: '2027-02-19T10:00:00.000Z',
      },
      'created API token **chain bot** (scopes `map`, `signatures`, expires 2027-02-19)',
    ],
    [
      {
        kind: 'api.token_created',
        eventId: 8,
        tokenId: '12',
        label: 'chain bot',
        scopes: ['map'],
        expiresAt: null,
      },
      'created API token **chain bot** (scopes `map`, no expiry)',
    ],
    [
      {
        kind: 'api.token_revoked',
        eventId: 9,
        tokenId: '12',
        label: 'chain bot',
        reason: 'manager',
      },
      'revoked API token **chain bot** owned by **Pilot Bar**',
      ownerCtx,
    ],
    [
      {
        kind: 'api.token_revoked',
        eventId: 10,
        tokenId: '12',
        label: 'chain bot',
        reason: 'abuse',
      },
      'revoked API token **chain bot** owned by **Pilot Bar** after repeated rate-limit abuse',
      ownerCtx,
    ],
    [
      {
        kind: 'api.token_revoked',
        eventId: 11,
        tokenId: '12',
        label: 'chain bot',
        reason: 'creator',
      },
      'revoked API token **chain bot** owned by **an unknown pilot**',
    ],
    [
      {
        kind: 'api.token_suspended',
        eventId: 12,
        tokenId: '12',
        label: 'chain bot',
        until: '2026-11-21T14:30:00.000Z',
        strike: 1,
      },
      'suspended API token **chain bot** owned by **Pilot Bar** for rate-limit abuse (strike 1, until 2026-11-21 14:30 UTC)',
      ownerCtx,
    ],
    [
      {
        kind: 'api.token_revoked',
        eventId: 14,
        tokenId: '12',
        label: 'chain bot',
        reason: 'manager',
      },
      'revoked API token **chain bot**',
      { ...ownerCtx, hideActor: true },
    ],
  ];

  for (const [event, expected, ctx] of cases) {
    it(`renders ${event.kind} (event ${event.eventId}) with no actor`, () => {
      expect(describeMapEvent(event, ctx ?? baseCtx)).toBe(expected);
    });
  }

  it('prefixes the actor in the Discord history line, and Aperture for automation', () => {
    const event: MapEventPayload = {
      kind: 'api.token_suspended',
      eventId: 13,
      tokenId: '12',
      label: 'chain bot',
      until: '2026-11-21T20:30:00.000Z',
      strike: 2,
    };
    expect(formatHistoryMessage(event, { ...ownerCtx, characterName: null })?.content).toBe(
      '**Test Map**: Aperture suspended API token **chain bot** owned by **Pilot Bar** for rate-limit abuse (strike 2, until 2026-11-21 20:30 UTC).',
    );
  });
});

describe('formatRallyMessage', () => {
  it('renders an embed with red color, title, and the rally timestamp', () => {
    const event: MapEventPayload = {
      kind: 'system.updated',
      eventId: 9,
      id: '42',
      rallyAt: '2026-05-27T12:00:00.000Z',
    };
    const payload = formatRallyMessage(event, baseCtx);
    expect(payload?.embeds).toHaveLength(1);
    const embed = payload!.embeds![0]!;
    expect(embed.title).toBe('Rally point set in Jita');
    expect(embed.description).toBe('Set by **Pilot Foo** on **Test Map**.');
    expect(embed.color).toBe(0xe74c3c);
    expect(embed.timestamp).toBe('2026-05-27T12:00:00.000Z');
  });

  it('names no setter while Blackout hides it', () => {
    const event: MapEventPayload = {
      kind: 'system.updated',
      eventId: 9,
      id: '42',
      rallyAt: '2026-05-27T12:00:00.000Z',
    };
    const embed = formatRallyMessage(event, { ...baseCtx, hideActor: true })!.embeds![0]!;
    expect(embed.description).toBe('Set on **Test Map**.');
  });

  it('returns null when the event is not a rally-set event', () => {
    const event: MapEventPayload = {
      kind: 'system.updated',
      eventId: 10,
      id: '42',
      rallyAt: null,
    };
    expect(formatRallyMessage(event, baseCtx)).toBeNull();
  });
});
