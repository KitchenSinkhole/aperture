import { describe, it, expect } from 'vitest';
import { referenceScheme } from '@/lib/bookmarking/reference';
import type { BookmarkInput } from '@/lib/bookmarking/types';
import type { MapConnectionEdge, MapSignature, MapSystemNode } from '@/types';

// Pure tests for the reference bookmark scheme. No db.

function makeSystem(overrides: Partial<MapSystemNode> & { id: string }): MapSystemNode {
  return {
    systemId: 30000001,
    name: 'DefaultName',
    alias: null,
    tag: null,
    intelNotes: 'unread field',
    status: 'unknown',
    security: null,
    trueSec: null,
    effect: null,
    regionName: 'DefaultRegion',
    constellationName: 'DefaultConstellation',
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

function makeConnection(overrides: Partial<MapConnectionEdge> = {}): MapConnectionEdge {
  return {
    id: 'conn-1',
    source: 'sys-here',
    target: 'sys-camefrom',
    scope: 'wh',
    massStatus: 'fresh',
    jumpMassClass: null,
    eolStage: 'none',
    preserveMass: false,
    isRolling: false,
    isStatic: false,
    sourceBubbled: false,
    targetBubbled: false,
    eolAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSignature(overrides: Partial<MapSignature> & { mapSystemId: string }): MapSignature {
  return {
    id: 'sig-default-id',
    mapConnectionId: 'conn-1',
    sigId: 'ABC-123',
    groupKey: 'wormhole',
    classKind: 'signature',
    activityOverride: null,
    typeId: 99999,
    eolStage: 'none',
    wormholeCode: 'B274',
    name: 'DefaultSigName',
    description: 'default sig desc',
    expiresAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('referenceScheme — full field coverage', () => {
  const here = makeSystem({
    id: 'here-id-distinctive',
    systemId: 31000123,
    name: 'HereSystemName',
    alias: 'HereAliasValue',
    tag: 'HereTagValue',
    status: 'friendly',
    security: 'HereSecurityValue',
    trueSec: 0.42,
    effect: 'HereEffectValue',
    regionName: 'HereRegionName',
    constellationName: 'HereConstellationName',
    statics: [
      { label: 'HereStaticLabelOne', typeId: 11111 },
      { label: 'HereStaticLabelTwo', typeId: 22222 },
    ],
    tradeHub: { name: 'HereTradeHubName', jumps: 7 },
    // Not-read fields — distinctive too, so a leak would be caught.
    positionX: 111,
    positionY: 222,
    locked: true,
    lockedByCharacterId: 999,
    lockedByName: 'HereLockHolderName',
    rallyAt: '2026-08-01T01:00:00.000Z',
    intelNotes: 'HereIntelNotesValue',
  });

  const cameFrom = makeSystem({
    id: 'camefrom-id-distinctive',
    systemId: 31000456,
    name: 'CameFromSystemName',
    alias: 'CameFromAliasValue',
    tag: 'CameFromTagValue',
    status: 'hostile',
    security: 'CameFromSecurityValue',
    trueSec: -0.15,
    effect: 'CameFromEffectValue',
    regionName: 'CameFromRegionName',
    constellationName: 'CameFromConstellationName',
    statics: [{ label: 'CameFromStaticLabelOne', typeId: 33333 }],
    tradeHub: { name: 'CameFromTradeHubName', jumps: 3 },
    positionX: 333,
    positionY: 444,
    locked: false,
    lockedByCharacterId: 888,
    lockedByName: 'CameFromLockHolderName',
    rallyAt: '2026-08-01T02:00:00.000Z',
    intelNotes: 'CameFromIntelNotesValue',
  });

  const connection = makeConnection({
    id: 'conn-distinctive-id',
    source: here.id,
    target: cameFrom.id,
    scope: 'jumpbridge',
    massStatus: 'reduced',
    jumpMassClass: 'xl',
    eolStage: 'critical',
    eolAt: '2026-08-01T03:00:00.000Z',
    createdAt: '2026-08-01T04:00:00.000Z',
    isStatic: true,
    isRolling: true,
    preserveMass: true,
    sourceBubbled: true,
    targetBubbled: true,
  });

  const hereSig = makeSignature({
    mapSystemId: here.id,
    id: 'sig-here-internal-id',
    mapConnectionId: connection.id,
    sigId: 'HXY-111',
    groupKey: 'gas',
    classKind: 'anomaly',
    typeId: 55555,
    eolStage: 'eol',
    wormholeCode: 'H900',
    name: 'HereSigNameValue',
    description: 'HereSigDescriptionValue',
    expiresAt: '2026-08-03T00:00:00.000Z',
  });

  const cameFromSig = makeSignature({
    mapSystemId: cameFrom.id,
    id: 'sig-camefrom-internal-id',
    mapConnectionId: connection.id,
    sigId: 'CFZ-222',
    groupKey: 'data',
    classKind: 'signature',
    typeId: 66666,
    eolStage: 'expired',
    wormholeCode: 'C247',
    name: 'CameFromSigNameValue',
    description: 'CameFromSigDescriptionValue',
    expiresAt: '2026-08-04T00:00:00.000Z',
  });

  const hopsFromHome = new Map<string, number>([
    [here.id, 5],
    [cameFrom.id, 6],
  ]);

  // Extra connections incident only to `here`, giving the two endpoints
  // different incident-connection counts (`here`: 3, `cameFrom`: 2).
  const hereExtraConn1 = makeConnection({ id: 'conn-extra-here-1', source: here.id, target: 'elsewhere-1' });
  const hereExtraConn2 = makeConnection({ id: 'conn-extra-here-2', source: 'elsewhere-2', target: here.id });

  const input: BookmarkInput = {
    here,
    cameFrom,
    connection,
    connections: [connection, hereExtraConn1, hereExtraConn2],
    signatures: [hereSig, cameFromSig],
    hopsFromHome,
    homeMapSystemId: here.id,
  };

  const result = referenceScheme.names(input);

  it('returns non-null names for both endpoints', () => {
    expect(result).not.toBeNull();
  });

  const combined = `${result!.here}\n${result!.cameFrom}`;

  // Every value is asserted as its exact `KEY=value` token (the pattern the
  // HOPS=/HOME=/DEGREE= assertions below use), so a value that happens to
  // collide with another field's raw text (e.g. a signature's wormholeCode
  // containing a security label as a substring) still can't produce a false
  // pass — the key pins which field the value has to come from.
  // `HOPS=`/`HOME=`/`DEGREE=` are covered by their own dedicated tests below,
  // so they aren't repeated here.
  const expectedKeyedValues = [
    // here endpoint
    'NAME=HereSystemName',
    'ALIAS=HereAliasValue',
    'TAG=HereTagValue',
    'STATUS=friendly',
    'SEC=HereSecurityValue',
    'TRUESEC=0.42',
    'EFFECT=HereEffectValue',
    'REGION=HereRegionName',
    'CONST=HereConstellationName',
    'STATICS=HereStaticLabelOne+HereStaticLabelTwo',
    'HUB=HereTradeHubName@7j',
    // cameFrom endpoint
    'NAME=CameFromSystemName',
    'ALIAS=CameFromAliasValue',
    'TAG=CameFromTagValue',
    'STATUS=hostile',
    'SEC=CameFromSecurityValue',
    'TRUESEC=-0.15',
    'EFFECT=CameFromEffectValue',
    'REGION=CameFromRegionName',
    'CONST=CameFromConstellationName',
    'STATICS=CameFromStaticLabelOne',
    'HUB=CameFromTradeHubName@3j',
    // connection
    'SCOPE=jumpbridge',
    'MASS=reduced',
    'JUMPCLASS=xl',
    'EOL=critical',
    'EOLAT=2026-08-01T03:00:00.000Z',
    'CREATED=2026-08-01T04:00:00.000Z',
    'STATIC=true',
    'ROLLING=true',
    'PRESERVE=true',
    'SRCBUBBLE=true',
    'TGTBUBBLE=true',
    // here signature
    'SIGID=HXY-111',
    'WHCODE=H900',
    'GROUP=gas',
    'CLASS=anomaly',
    'SIGEOL=eol',
    'SIGNAME=HereSigNameValue',
    'DESC=HereSigDescriptionValue',
    'EXPIRES=2026-08-03T00:00:00.000Z',
    // cameFrom signature
    'SIGID=CFZ-222',
    'WHCODE=C247',
    'GROUP=data',
    'CLASS=signature',
    'SIGEOL=expired',
    'SIGNAME=CameFromSigNameValue',
    'DESC=CameFromSigDescriptionValue',
    'EXPIRES=2026-08-04T00:00:00.000Z',
  ];

  it.each(expectedKeyedValues)('emits the keyed token %j somewhere in the output', (token) => {
    expect(combined).toContain(token);
  });

  it('emits hop counts for both endpoints', () => {
    expect(combined).toContain('HOPS=5');
    expect(combined).toContain('HOPS=6');
  });

  it('emits distinct incident-connection counts for both endpoints', () => {
    expect(combined).toContain('DEGREE=3'); // here: connection + 2 extras
    expect(combined).toContain('DEGREE=1'); // cameFrom: connection only
  });

  it('marks the Home endpoint true and the other false', () => {
    expect(result!.here).toContain('HOME=true');
    // cameFrom is not Home in this fixture — assert false appears at least once.
    expect(combined).toContain('HOME=false');
  });

  it('does not leak internal ids into either output', () => {
    for (const leaked of [
      here.id,
      cameFrom.id,
      connection.id,
      hereSig.id,
      cameFromSig.id,
      String(hereSig.typeId),
      String(cameFromSig.typeId),
      String(here.systemId),
      String(cameFrom.systemId),
      String(here.statics[0]!.typeId),
      String(here.statics[1]!.typeId),
      String(cameFrom.statics[0]!.typeId),
    ]) {
      expect(combined).not.toContain(leaked);
    }
  });

  it('does not leak non-readable endpoint fields into either output', () => {
    for (const leaked of [
      'HereLockHolderName',
      'CameFromLockHolderName',
      'HereIntelNotesValue',
      'CameFromIntelNotesValue',
      '2026-08-01T01:00:00.000Z', // rallyAt
      '2026-08-01T02:00:00.000Z', // rallyAt
    ]) {
      expect(combined).not.toContain(leaked);
    }
  });
});

describe('referenceScheme — sparse cases do not throw', () => {
  const baseHere = makeSystem({ id: 'sparse-here' });
  const baseCameFrom = makeSystem({ id: 'sparse-camefrom' });
  const baseConnection = makeConnection({ source: 'sparse-here', target: 'sparse-camefrom' });

  it('handles null tag, alias, effect, trueSec on both endpoints', () => {
    const input: BookmarkInput = {
      here: baseHere,
      cameFrom: baseCameFrom,
      connection: baseConnection,
      connections: [baseConnection],
      signatures: [],
      hopsFromHome: new Map(),
      homeMapSystemId: null,
    };
    expect(() => referenceScheme.names(input)).not.toThrow();
    const result = referenceScheme.names(input);
    expect(result).not.toBeNull();
  });

  it('handles a null jumpMassClass and null eolAt on the connection', () => {
    const conn = makeConnection({ jumpMassClass: null, eolAt: null });
    const input: BookmarkInput = {
      here: baseHere,
      cameFrom: baseCameFrom,
      connection: conn,
      connections: [conn],
      signatures: [],
      hopsFromHome: new Map(),
      homeMapSystemId: null,
    };
    expect(() => referenceScheme.names(input)).not.toThrow();
  });

  it('handles a null tradeHub and an empty statics array', () => {
    const noHub = makeSystem({ id: 'no-hub', tradeHub: null, statics: [] });
    const conn = makeConnection({ source: 'no-hub', target: 'sparse-camefrom' });
    const input: BookmarkInput = {
      here: noHub,
      cameFrom: baseCameFrom,
      connection: conn,
      connections: [conn],
      signatures: [],
      hopsFromHome: new Map(),
      homeMapSystemId: null,
    };
    const result = referenceScheme.names(input);
    expect(result!.here).toContain('HUB=-');
    expect(result!.here).toContain('STATICS=none');
  });

  it('handles an endpoint absent from hopsFromHome', () => {
    const input: BookmarkInput = {
      here: baseHere,
      cameFrom: baseCameFrom,
      connection: baseConnection,
      connections: [baseConnection],
      signatures: [],
      hopsFromHome: new Map(), // neither endpoint present
      homeMapSystemId: null,
    };
    const result = referenceScheme.names(input);
    expect(result!.here).toContain('HOPS=-');
    expect(result!.cameFrom).toContain('HOPS=-');
  });

  it('handles a null homeMapSystemId (no endpoint is Home)', () => {
    const input: BookmarkInput = {
      here: baseHere,
      cameFrom: baseCameFrom,
      connection: baseConnection,
      connections: [baseConnection],
      signatures: [],
      hopsFromHome: new Map(),
      homeMapSystemId: null,
    };
    const result = referenceScheme.names(input);
    expect(result!.here).toContain('HOME=false');
    expect(result!.cameFrom).toContain('HOME=false');
  });

  it('handles zero signature rows for a side', () => {
    const input: BookmarkInput = {
      here: baseHere,
      cameFrom: baseCameFrom,
      connection: baseConnection,
      connections: [baseConnection],
      signatures: [],
      hopsFromHome: new Map(),
      homeMapSystemId: null,
    };
    const result = referenceScheme.names(input);
    expect(result!.here).toContain('HERESIG[SIG=none]');
    expect(result!.here).toContain('OTHERSIG[SIG=none]');
  });

  it('handles exactly one signature row (only the here side)', () => {
    const sig = makeSignature({ mapSystemId: baseHere.id });
    const input: BookmarkInput = {
      here: baseHere,
      cameFrom: baseCameFrom,
      connection: baseConnection,
      connections: [baseConnection],
      signatures: [sig],
      hopsFromHome: new Map(),
      homeMapSystemId: null,
    };
    const result = referenceScheme.names(input);
    expect(result!.here).toContain(`SIGID=${sig.sigId}`);
    expect(result!.cameFrom).toContain('SIG=none');
  });

  it('handles two signature rows, one per side', () => {
    const hereSig = makeSignature({ mapSystemId: baseHere.id, sigId: 'ONE-111' });
    const cameFromSig = makeSignature({ mapSystemId: baseCameFrom.id, sigId: 'TWO-222' });
    const input: BookmarkInput = {
      here: baseHere,
      cameFrom: baseCameFrom,
      connection: baseConnection,
      connections: [baseConnection],
      signatures: [hereSig, cameFromSig],
      hopsFromHome: new Map(),
      homeMapSystemId: null,
    };
    const result = referenceScheme.names(input);
    expect(result!.here).toContain('SIGID=ONE-111');
    expect(result!.here).toContain('SIGID=TWO-222');
    expect(result!.cameFrom).toContain('SIGID=ONE-111');
    expect(result!.cameFrom).toContain('SIGID=TWO-222');
  });
});
