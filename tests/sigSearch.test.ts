import { describe, expect, it } from 'vitest';
import { buildSigSearchResults } from '@/lib/map/sigSearch';
import type { MapSignature, MapSystemNode, SigSearchFilters } from '@/types';

const NOW = new Date('2026-06-11T12:00:00Z').getTime();

function makeSig(
  overrides: Partial<MapSignature> & { id: string; sigId: string; mapSystemId: string; createdAt: string },
): MapSignature {
  return {
    mapConnectionId: null,
    groupKey: null,
    classKind: null,
    activityOverride: null,
    typeId: null,
    eolStage: 'none',
    wormholeCode: null,
    name: null,
    description: null,
    expiresAt: new Date(NOW + 86_400_000).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function makeSystem(
  overrides: Partial<MapSystemNode> & { id: string; name: string },
): MapSystemNode {
  return {
    systemId: 30_000_001,
    alias: null,
    tag: null,
    intelNotes: null,
    status: 'unknown',
    security: 'C3',
    trueSec: null,
    effect: null,
    regionName: 'A-R00001',
    constellationName: 'A-C00001',
    statics: [],
    staticTypeIds: [],
    tradeHub: null,
    locked: false,
    lockedByCharacterId: null,
    lockedByName: null,
    rallyAt: null,
    positionX: 0,
    positionY: 0,
    ...overrides,
  };
}

const BASE: SigSearchFilters = {
  name: '',
  groupKey: null,
  maxAgeHours: null,
  securityClasses: [],
  includeAnomalies: true,
  includeSignatures: true,
  activity: null,
};

describe('buildSigSearchResults', () => {
  it('returns all rows when filters are empty', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const a = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW - 3_600_000).toISOString() });
    const b = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW - 7_200_000).toISOString() });
    const rows = buildSigSearchResults([a, b], [sys], BASE, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.sig.sigId).toBe('AAA');
    expect(rows[1]!.sig.sigId).toBe('BBB');
  });

  it('filters by name — case-insensitive partial match', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const a = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), name: 'Eagle Nebula' });
    const b = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), name: 'Combat Site' });
    const rows = buildSigSearchResults([a, b], [sys], { ...BASE, name: 'nebula' }, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sig.sigId).toBe('AAA');
  });

  it('name filter does not match sigs with null name', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const a = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), name: null });
    const rows = buildSigSearchResults([a], [sys], { ...BASE, name: 'gas' }, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(0);
  });

  it('filters by groupKey', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const gas = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'gas' });
    const wh = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'wormhole' });
    const rows = buildSigSearchResults([gas, wh], [sys], { ...BASE, groupKey: 'gas' }, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sig.sigId).toBe('AAA');
  });

  it('filters by activity over the effective value, respecting overrides', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    // gas → derived combat
    const gas = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'gas', name: 'Barren Perimeter Reservoir' });
    // ore → derived exploration
    const ore = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'ore', name: 'Common Perimeter Deposit' });
    // gas but overridden to exploration (cleared site) — should read as exploration
    const cleared = makeSig({ id: '3', sigId: 'CCC', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'gas', name: 'Vast Frontier Reservoir', activityOverride: 'exploration' });

    const combat = buildSigSearchResults([gas, ore, cleared], [sys], { ...BASE, activity: 'combat' }, 'sigId', 'asc', NOW);
    expect(combat.map((r) => r.sig.sigId)).toEqual(['AAA']);

    const explo = buildSigSearchResults([gas, ore, cleared], [sys], { ...BASE, activity: 'exploration' }, 'sigId', 'asc', NOW);
    expect(explo.map((r) => r.sig.sigId)).toEqual(['BBB', 'CCC']);
  });

  it('filters by maxAgeHours', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const fresh = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW - 1_800_000).toISOString() }); // 30 min
    const stale = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW - 7_200_000).toISOString() }); // 2 h
    const rows = buildSigSearchResults([fresh, stale], [sys], { ...BASE, maxAgeHours: 1 }, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sig.sigId).toBe('AAA');
  });

  it('filters by securityClasses', () => {
    const whSys = makeSystem({ id: 's1', name: 'J123456', security: 'C3' });
    const hsSys = makeSystem({ id: 's2', name: 'Jita', security: 'H' });
    const whSig = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString() });
    const hsSig = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's2', createdAt: new Date(NOW).toISOString() });
    const rows = buildSigSearchResults([whSig, hsSig], [whSys, hsSys], { ...BASE, securityClasses: ['C3'] }, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sig.sigId).toBe('AAA');
  });

  it('drops sigs whose system is not in the systems list', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const orphan = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 'unknown', createdAt: new Date(NOW).toISOString() });
    const rows = buildSigSearchResults([orphan], [sys], BASE, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(0);
  });

  it('sorts by age descending — oldest first', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const newer = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW - 3_600_000).toISOString() });
    const older = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW - 7_200_000).toISOString() });
    const rows = buildSigSearchResults([newer, older], [sys], BASE, 'age', 'desc', NOW);
    expect(rows[0]!.sig.sigId).toBe('BBB');
    expect(rows[1]!.sig.sigId).toBe('AAA');
  });

  it('sorts by systemName ascending using alias when set', () => {
    const sysA = makeSystem({ id: 's1', name: 'J111111', alias: 'Bravo' });
    const sysB = makeSystem({ id: 's2', name: 'J222222', alias: 'Alpha' });
    const sigA = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString() });
    const sigB = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's2', createdAt: new Date(NOW).toISOString() });
    const rows = buildSigSearchResults([sigA, sigB], [sysA, sysB], BASE, 'systemName', 'asc', NOW);
    expect(rows[0]!.system.alias).toBe('Alpha');
    expect(rows[1]!.system.alias).toBe('Bravo');
  });

  it('sorts by sigId descending', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const a = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString() });
    const b = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW).toISOString() });
    const rows = buildSigSearchResults([a, b], [sys], BASE, 'sigId', 'desc', NOW);
    expect(rows[0]!.sig.sigId).toBe('BBB');
    expect(rows[1]!.sig.sigId).toBe('AAA');
  });

  it('sorts by age ascending — newest first', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const newer = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW - 3_600_000).toISOString() });
    const older = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW - 7_200_000).toISOString() });
    const rows = buildSigSearchResults([older, newer], [sys], BASE, 'age', 'asc', NOW);
    expect(rows[0]!.sig.sigId).toBe('AAA');
    expect(rows[1]!.sig.sigId).toBe('BBB');
  });

  it('sorts by systemName descending and falls back to name when alias is null', () => {
    const sysA = makeSystem({ id: 's1', name: 'J999999', alias: null }); // sorts on name 'J999999'
    const sysB = makeSystem({ id: 's2', name: 'J222222', alias: 'Alpha' }); // sorts on alias 'Alpha'
    const sigA = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString() });
    const sigB = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's2', createdAt: new Date(NOW).toISOString() });
    const rows = buildSigSearchResults([sigA, sigB], [sysA, sysB], BASE, 'systemName', 'desc', NOW);
    // 'J999999' > 'Alpha', so descending puts the null-alias (name) system first.
    expect(rows[0]!.system.id).toBe('s1');
    expect(rows[1]!.system.id).toBe('s2');
  });

  it('securityClasses filter keeps systems from any listed class', () => {
    const c3 = makeSystem({ id: 's1', name: 'J123456', security: 'C3' });
    const hs = makeSystem({ id: 's2', name: 'Jita', security: 'H' });
    const ls = makeSystem({ id: 's3', name: 'Tama', security: 'L' });
    const sigC3 = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString() });
    const sigHs = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's2', createdAt: new Date(NOW).toISOString() });
    const sigLs = makeSig({ id: '3', sigId: 'CCC', mapSystemId: 's3', createdAt: new Date(NOW).toISOString() });
    const rows = buildSigSearchResults(
      [sigC3, sigHs, sigLs],
      [c3, hs, ls],
      { ...BASE, securityClasses: ['C3', 'H'] },
      'sigId',
      'asc',
      NOW,
    );
    expect(rows.map((r) => r.sig.sigId)).toEqual(['AAA', 'BBB']);
  });

  it('securityClasses filter excludes a system whose security is null', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456', security: null });
    const sig = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString() });
    const rows = buildSigSearchResults([sig], [sys], { ...BASE, securityClasses: ['C3'] }, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(0);
  });

  it('name filter trims surrounding whitespace', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const sig = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), name: 'Eagle Nebula' });
    const rows = buildSigSearchResults([sig], [sys], { ...BASE, name: '  nebula  ' }, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(1);
  });

  it('maxAgeHours boundary is inclusive — exactly at the limit is kept, just over is dropped', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const exact = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW - 3_600_000).toISOString() }); // 1h
    const over = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW - 3_600_001).toISOString() }); // 1h + 1ms
    const rows = buildSigSearchResults([exact, over], [sys], { ...BASE, maxAgeHours: 1 }, 'sigId', 'asc', NOW);
    expect(rows.map((r) => r.sig.sigId)).toEqual(['AAA']);
  });

  it('maxAgeHours of 0 drops every aged signature', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const sig = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW - 1_000).toISOString() }); // 1s old
    const rows = buildSigSearchResults([sig], [sys], { ...BASE, maxAgeHours: 0 }, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(0);
  });

  it('applies name, groupKey and securityClasses filters together (AND)', () => {
    const c3 = makeSystem({ id: 's1', name: 'J123456', security: 'C3' });
    const hs = makeSystem({ id: 's2', name: 'Jita', security: 'H' });
    const match = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'gas', name: 'Vast Frontier Reservoir' });
    const wrongName = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'gas', name: 'Barren Perimeter Reservoir' });
    const wrongGroup = makeSig({ id: '3', sigId: 'CCC', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'wormhole', name: 'Vast Frontier Reservoir' });
    const wrongSec = makeSig({ id: '4', sigId: 'DDD', mapSystemId: 's2', createdAt: new Date(NOW).toISOString(), groupKey: 'gas', name: 'Vast Frontier Reservoir' });
    const rows = buildSigSearchResults(
      [match, wrongName, wrongGroup, wrongSec],
      [c3, hs],
      { ...BASE, name: 'vast', groupKey: 'gas', securityClasses: ['C3'] },
      'sigId',
      'asc',
      NOW,
    );
    expect(rows.map((r) => r.sig.sigId)).toEqual(['AAA']);
  });

  it('hides anomalies when includeAnomalies is false', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const anom = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'combat', classKind: 'anomaly' });
    const sig = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'relic', classKind: 'signature' });
    const rows = buildSigSearchResults([anom, sig], [sys], { ...BASE, includeAnomalies: false }, 'sigId', 'asc', NOW);
    expect(rows.map((r) => r.sig.sigId)).toEqual(['BBB']);
  });

  it('hides signatures when includeSignatures is false', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const anom = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'combat', classKind: 'anomaly' });
    const sig = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'relic', classKind: 'signature' });
    const rows = buildSigSearchResults([anom, sig], [sys], { ...BASE, includeSignatures: false }, 'sigId', 'asc', NOW);
    expect(rows.map((r) => r.sig.sigId)).toEqual(['AAA']);
  });

  it('hides a classed sig with no group when its class toggle is off', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    // A pasted Cosmic Signature with no resolved group is still classKind 'signature'.
    const ungrouped = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: null, classKind: 'signature' });
    const rows = buildSigSearchResults([ungrouped], [sys], { ...BASE, includeSignatures: false }, 'sigId', 'asc', NOW);
    expect(rows).toHaveLength(0);
  });

  it('always shows a sig with an unknown class even when both toggles are off', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const nullClass = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: null, classKind: null });
    const rows = buildSigSearchResults([nullClass], [sys], { ...BASE, includeAnomalies: false, includeSignatures: false }, 'sigId', 'asc', NOW);
    expect(rows.map((r) => r.sig.sigId)).toEqual(['AAA']);
  });

  it('with both class toggles off, only unknown-class rows remain', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    const anom = makeSig({ id: '1', sigId: 'AAA', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'combat', classKind: 'anomaly' });
    const sig = makeSig({ id: '2', sigId: 'BBB', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: null, classKind: 'signature' });
    const nullClass = makeSig({ id: '3', sigId: 'CCC', mapSystemId: 's1', createdAt: new Date(NOW).toISOString(), groupKey: 'gas', classKind: null });
    const rows = buildSigSearchResults([anom, sig, nullClass], [sys], { ...BASE, includeAnomalies: false, includeSignatures: false }, 'sigId', 'asc', NOW);
    expect(rows.map((r) => r.sig.sigId)).toEqual(['CCC']);
  });

  it('returns an empty array for empty signatures input', () => {
    const sys = makeSystem({ id: 's1', name: 'J123456' });
    expect(buildSigSearchResults([], [sys], BASE, 'sigId', 'asc', NOW)).toEqual([]);
  });
});
