import { describe, expect, it } from 'vitest';
import { resolveShipClass, SHIP_GROUP_CLASS, SHIP_TYPE_CLASS_OVERRIDES } from '@/lib/eve/shipClass';

// Special Edition Yachts (group 5087) is deliberately bucketed as `cruiser` —
// vanity hulls with no dedicated class, but closer in size/role to a cruiser
// than any other bucket.
describe('resolveShipClass — Special Edition Yachts', () => {
  const YACHT_GROUP_ID = 5087;
  const yachtTypeIds = [
    92283, // Moreau YC128 Campaign Bus
    25560, // Opux Dragoon Yacht
    635, // Opux Luxury Yacht
    92284, // Roden YC128 Campaign Bus
    92282, // Tenzin YC128 Campaign Bus
    34590, // Victorieux Luxury Yacht
  ];

  it('resolves the yacht group itself to cruiser', () => {
    expect(SHIP_GROUP_CLASS[YACHT_GROUP_ID]).toBe('cruiser');
  });

  it.each(yachtTypeIds)('resolves yacht type %i to cruiser', (typeId) => {
    expect(resolveShipClass(typeId, YACHT_GROUP_ID)).toBe('cruiser');
  });
});

// A handful of mining hulls share a group with a differently-classed sibling
// despite a distinct in-game role label, so they're keyed individually in
// SHIP_TYPE_CLASS_OVERRIDES and checked before the group falls through.
describe('resolveShipClass — mining ship overrides', () => {
  const FRIGATE_GROUP_ID = 25; // Frigate — Venture's actual SDE group
  const COMMAND_DESTROYER_GROUP_ID = 1534; // Command Destroyer — Outrider's actual SDE group
  const DESTROYER_GROUP_ID = 420; // Destroyer — Pioneer/Perseverance's actual SDE group

  it('resolves Venture to mining-frigate despite sitting in the plain Frigate group', () => {
    expect(SHIP_TYPE_CLASS_OVERRIDES[32880]).toBe('mining-frigate');
    expect(resolveShipClass(32880, FRIGATE_GROUP_ID)).toBe('mining-frigate');
  });

  it('resolves Venture Consortium Issue to mining-frigate despite sitting in the plain Frigate group', () => {
    expect(SHIP_TYPE_CLASS_OVERRIDES[89648]).toBe('mining-frigate');
    expect(resolveShipClass(89648, FRIGATE_GROUP_ID)).toBe('mining-frigate');
  });

  it('resolves Outrider to mining-destroyer despite sitting in the Command Destroyer group', () => {
    expect(SHIP_TYPE_CLASS_OVERRIDES[89649]).toBe('mining-destroyer');
    expect(resolveShipClass(89649, COMMAND_DESTROYER_GROUP_ID)).toBe('mining-destroyer');
  });

  it('resolves Pioneer to mining-destroyer despite sitting in the plain Destroyer group', () => {
    expect(SHIP_TYPE_CLASS_OVERRIDES[89240]).toBe('mining-destroyer');
    expect(resolveShipClass(89240, DESTROYER_GROUP_ID)).toBe('mining-destroyer');
  });

  it('resolves Perseverance to mining-destroyer despite sitting in the plain Destroyer group', () => {
    expect(SHIP_TYPE_CLASS_OVERRIDES[91174]).toBe('mining-destroyer');
    expect(resolveShipClass(91174, DESTROYER_GROUP_ID)).toBe('mining-destroyer');
  });

  it('resolves Pioneer Consortium Issue to mining-destroyer despite sitting in the plain Destroyer group', () => {
    expect(SHIP_TYPE_CLASS_OVERRIDES[89647]).toBe('mining-destroyer');
    expect(resolveShipClass(89647, DESTROYER_GROUP_ID)).toBe('mining-destroyer');
  });

  it('falls back to the group class for an un-overridden hull in the same groups', () => {
    // Rifter (587) — a generic frigate in group 25 (not Venture) classifies as plain frigate.
    expect(resolveShipClass(587, FRIGATE_GROUP_ID)).toBe('frigate');
    // Catalyst (16240) — a generic destroyer in group 420 (not Pioneer/Perseverance) classifies as plain destroyer.
    expect(resolveShipClass(16240, DESTROYER_GROUP_ID)).toBe('destroyer');
  });
});
