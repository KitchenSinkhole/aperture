import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IntelModule } from '@/components/sidebar/IntelModule';
import type { MapSystemNode } from '@/lib/map/loadMap';
import type { SystemIntelSummary } from '@/lib/map/intel';

const SYSTEM: MapSystemNode = {
  id: '1',
  systemId: 30000142,
  name: 'Jita',
  alias: null,
  tag: null,
  intelNotes: null,
  status: 'unknown',
  security: 'H',
  trueSec: 0.9,
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

const INTEL: SystemIntelSummary = {
  sovereignty: null,
  factionWar: null,
  incursion: null,
  scoutConnections: [
    {
      sourceName: 'Thera',
      sourceSystemId: 31000005,
      targetName: 'Jita',
      targetSystemId: 30000142,
      signatureId: 'ABC',
      hub: 'Thera',
      updatedAt: null,
      expiresAt: null,
    },
  ],
  links: {
    dotlan: 'https://evemaps.dotlan.net/system/Jita',
    eveeye: 'https://eveeye.com/?system=30000142',
    anoik: 'https://anoik.is/systems/Jita',
    zkillboard: 'https://zkillboard.com/system/30000142/',
  },
};

describe('IntelModule', () => {
  it('renders selected-system intel', () => {
    const html = renderToStaticMarkup(<IntelModule system={SYSTEM} intel={INTEL} />);
    expect(html).toContain('The Forge');
    expect(html).toContain('EVE-Scout');
    expect(html).toContain('DOTLAN');
  });

  it('renders empty state without a selected system', () => {
    const html = renderToStaticMarkup(<IntelModule system={null} intel={undefined} />);
    expect(html).toContain('Select a system to see intel.');
  });
});
