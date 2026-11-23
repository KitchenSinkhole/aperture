import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SignatureModule } from '@/components/sidebar/SignatureModule';
import type { EolSource, MapConnectionEdge, MapSignature, MapSystemNode } from '@/types';

const ESTIMATE_HINT = 'Estimated from the hole';

const sys1: MapSystemNode = {
  id: '10',
  systemId: 31000001,
  name: 'J100001',
  alias: null,
  tag: null,
  intelNotes: null,
  status: 'unknown',
  security: 'C3',
  trueSec: -1,
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
};

const sys2: MapSystemNode = { ...sys1, id: '11', systemId: 31000002, name: 'J100002' };

const conn = (eolSource: EolSource | null): MapConnectionEdge => ({
  id: '20',
  source: '10',
  target: '11',
  scope: 'wh',
  massStatus: 'fresh',
  jumpMassClass: null,
  eolStage: 'eol',
  preserveMass: false,
  isStatic: false,
  sourceBubbled: false,
  targetBubbled: false,
  isRolling: false,
  eolAt: '2026-01-01T00:00:00.000Z',
  eolSource,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const sig: MapSignature = {
  id: '30',
  mapSystemId: '10',
  mapConnectionId: '20',
  sigId: 'ABC-123',
  groupKey: 'wormhole',
  classKind: 'signature',
  activityOverride: null,
  typeId: null,
  eolStage: 'none',
  wormholeCode: null,
  name: null,
  description: null,
  expiresAt: '2026-12-31T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const render = (connection: MapConnectionEdge) =>
  renderToStaticMarkup(
    <SignatureModule
      mapId="1"
      system={sys1}
      signatures={[sig]}
      connections={[connection]}
      systems={[sys1, sys2]}
      onCreate={() => {}}
      onPatch={() => {}}
      onDelete={() => {}}
      onConnectionPatch={() => {}}
      onBulkPaste={() => {}}
      tagScheme="none"
    />,
  );

describe('SignatureModule EOL cell — estimated vs observed', () => {
  it('marks a linked connection whose EOL is an age-based estimate', () => {
    expect(render(conn('auto'))).toContain(ESTIMATE_HINT);
  });

  it('does not mark a scout-observed EOL', () => {
    expect(render(conn('observed'))).not.toContain(ESTIMATE_HINT);
  });
});
