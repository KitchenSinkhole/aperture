import { describe, expect, it } from 'vitest';
import {
  formatHistoryMessage,
  formatRallyMessage,
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
      rallyAt: null,
      positionX: 0,
      positionY: 0,
    };
    const payload = formatHistoryMessage(event, baseCtx);
    expect(payload?.content).toBe('**Test Map** — Pilot Foo added **Jita** to the map.');
  });

  it('renders a rally-set update with the rally phrasing', () => {
    const event: MapEventPayload = {
      kind: 'system.updated',
      eventId: 2,
      id: '42',
      rallyAt: '2026-05-27T12:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map** — Pilot Foo set a rally point in **Jita**.',
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
      '**Test Map** — Pilot Foo cleared the rally point in **Jita**.',
    );
  });

  it('falls back to "Aperture" when no character is attached', () => {
    const event: MapEventPayload = {
      kind: 'system.removed',
      eventId: 4,
      id: '42',
    };
    const payload = formatHistoryMessage(event, { ...baseCtx, characterName: null });
    expect(payload?.content).toBe('**Test Map** — Aperture removed **Jita** from the map.');
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
      eolAt: null,
      createdAt: '2026-05-27T12:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map** — Pilot Foo connected **Jita** ↔ **Amarr**.',
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
      '**Test Map** — Pilot Foo updated **Jita** ↔ **Amarr** (EOL → ~4h).',
    );
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
      '**Test Map** — Pilot Foo updated **Jita** ↔ **Amarr** (EOL → critical (~1h)).',
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
      '**Test Map** — Pilot Foo updated **Jita** ↔ **Amarr** (max ship size → large).',
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
      '**Test Map** — Pilot Foo updated **Jita** ↔ **Amarr** (mass → `critical`, rolling started).',
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
      typeId: null,
      wormholeCode: null,
      name: null,
      description: null,
      expiresAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map** — Pilot Foo added signature `ABC-123` in **Jita**.',
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
      '**Test Map** — Pilot Foo updated signature `AUQ` in **Jita** (type → `B274`).',
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
      '**Test Map** — Pilot Foo updated signature `AUQ` in **Jita**.',
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
      '**Test Map** — Pilot Foo updated signature `AUQ` in **Jita** (type → `B274`).',
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
      '**Test Map** — Pilot Foo updated signature `AUQ` in **Jita** (unlinked from **Amarr**).',
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
      typeId: 31000,
      wormholeCode: 'C008',
      name: null,
      description: null,
      expiresAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      leadsToMapSystemId: '7', // → 'Amarr'
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map** — Pilot Foo added signature `LBS-432` in **Jita** (wormhole `C008`, leads to **Amarr**).',
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
      typeId: null,
      wormholeCode: null,
      name: 'Forgotten Frontier',
      description: null,
      expiresAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      leadsToMapSystemId: null,
    };
    expect(formatHistoryMessage(event, baseCtx)?.content).toBe(
      '**Test Map** — Pilot Foo added signature `XYZ-111` in **Jita** (relic site).',
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
      '**Test Map** — Pilot Foo removed the connection **Jita** ↔ **Amarr**.',
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
      '**Test Map** — Pilot Foo removed signature `ABC-123` from **Jita**.',
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
