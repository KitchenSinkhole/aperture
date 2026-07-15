import { describe, expect, it } from 'vitest';
import { characterUpdateLoadSchema } from '@/lib/realtime/protocol';

// The presence-badge / pilot-roster feature relies on `characterName` +
// `shipTypeName` + `shipClass` + `shipName` + the resolved `system*` fields being
// part of the wire contract; the client renders the hover panel / roster directly
// off these fields without a roster or SDE join. `userId`/`mainCharacterId`/`mainCharacterName`
// likewise ride the wire so the roster keeps grouping alts under their main.
describe('characterUpdateLoadSchema', () => {
  it('parses a complete online envelope', () => {
    const result = characterUpdateLoadSchema.safeParse({
      characterId: 90000001,
      characterName: 'Wojtek',
      userId: 42,
      mainCharacterId: 90000001,
      mainCharacterName: 'Wojtek',
      online: true,
      systemId: 30000142,
      systemName: 'Jita',
      systemSecurity: null,
      systemTrueSec: 0.9,
      shipTypeId: 11176,
      shipTypeName: 'Crow',
      shipClass: 'frigate',
      shipName: 'Speedy Boi',
      locationAt: '2026-05-26T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an offline envelope with null ship / system / main fields', () => {
    const result = characterUpdateLoadSchema.safeParse({
      characterId: 90000001,
      characterName: 'Wojtek',
      userId: 42,
      mainCharacterId: null,
      mainCharacterName: null,
      online: false,
      systemId: 30000142,
      systemName: null,
      systemSecurity: null,
      systemTrueSec: null,
      shipTypeId: null,
      shipTypeName: null,
      shipClass: null,
      shipName: null,
      locationAt: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing userId', () => {
    const result = characterUpdateLoadSchema.safeParse({
      characterId: 90000001,
      characterName: 'Wojtek',
      mainCharacterId: null,
      mainCharacterName: null,
      online: true,
      systemId: 30000142,
      systemName: 'Jita',
      systemSecurity: null,
      systemTrueSec: 0.9,
      shipTypeId: 11176,
      shipTypeName: 'Crow',
      shipClass: 'frigate',
      shipName: 'Speedy Boi',
      locationAt: '2026-05-26T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing characterName', () => {
    const result = characterUpdateLoadSchema.safeParse({
      characterId: 90000001,
      userId: 42,
      mainCharacterId: null,
      mainCharacterName: null,
      online: true,
      systemId: 30000142,
      shipTypeId: 11176,
      shipTypeName: 'Crow',
      shipClass: 'frigate',
      shipName: 'Speedy Boi',
      locationAt: '2026-05-26T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing shipTypeName', () => {
    const result = characterUpdateLoadSchema.safeParse({
      characterId: 90000001,
      characterName: 'Wojtek',
      userId: 42,
      mainCharacterId: null,
      mainCharacterName: null,
      online: true,
      systemId: 30000142,
      shipTypeId: 11176,
      shipClass: 'frigate',
      shipName: 'Speedy Boi',
      locationAt: '2026-05-26T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing shipClass', () => {
    const result = characterUpdateLoadSchema.safeParse({
      characterId: 90000001,
      characterName: 'Wojtek',
      userId: 42,
      mainCharacterId: null,
      mainCharacterName: null,
      online: true,
      systemId: 30000142,
      shipTypeId: 11176,
      shipTypeName: 'Crow',
      shipName: 'Speedy Boi',
      locationAt: '2026-05-26T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing shipName', () => {
    const result = characterUpdateLoadSchema.safeParse({
      characterId: 90000001,
      characterName: 'Wojtek',
      userId: 42,
      mainCharacterId: null,
      mainCharacterName: null,
      online: true,
      systemId: 30000142,
      shipTypeId: 11176,
      shipTypeName: 'Crow',
      shipClass: 'frigate',
      locationAt: '2026-05-26T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload with an invalid shipClass value', () => {
    const result = characterUpdateLoadSchema.safeParse({
      characterId: 90000001,
      characterName: 'Wojtek',
      userId: 42,
      mainCharacterId: null,
      mainCharacterName: null,
      online: true,
      systemId: 30000142,
      shipTypeId: 11176,
      shipTypeName: 'Crow',
      shipClass: 'not-a-real-class',
      shipName: 'Speedy Boi',
      locationAt: '2026-05-26T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
