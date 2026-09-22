import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted above the component imports: the bridge resolves the engine at event
// time, so a plain spy object is enough to record what it asked to play.
const play = vi.fn();
vi.mock('@/lib/sounds/engine', () => ({
  getSoundEngine: () => ({ play }),
}));

import { MapActiveCharProvider } from '@/components/map/MapActiveCharContext';
import { MapPresenceProvider } from '@/components/map/MapPresenceContext';
import { WatchedConnectionSoundBridge } from '@/components/map/WatchedConnectionSoundBridge';
import { toggleConnectionWatch } from '@/lib/connectionWatchPrefs';
import type { MapConnectionEdge, MapPresenceEntry, MapSystemNode } from '@/lib/map/loadMap';
import { RealtimeProvider } from '@/lib/realtime/useRealtime';

const MAP_ID = 7;
const SYSTEM_A = 31000001;
const SYSTEM_B = 31000002;
const SYSTEM_C = 31000003;
const ME = 100;
const FOREIGN = 200;

// `ap_map_system.id` per solar system, and the hole between A and B.
const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';
const HOLE_AB = 'conn-ab';
const GATE_BC = 'conn-bc';

// The watch store caches per map id, so each test claims its own.
let mapCounter = 0;

class FakePort {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  start = vi.fn();
  close = vi.fn();
}

let lastPort: FakePort | null = null;

class FakeSharedWorker {
  port: FakePort;
  constructor() {
    this.port = new FakePort();
    lastPort = this.port;
  }
}

function systemNode(id: string, systemId: number): MapSystemNode {
  return {
    id,
    systemId,
    name: `S${systemId}`,
    alias: null,
    tag: null,
    intelNotes: null,
    status: 'unknown',
    security: 'C5',
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
}

function connection(
  id: string,
  source: string,
  target: string,
  scope: MapConnectionEdge['scope'],
): MapConnectionEdge {
  return {
    id,
    source,
    target,
    scope,
    massStatus: 'fresh',
    jumpMassClass: null,
    eolStage: 'none',
    preserveMass: false,
    isRolling: false,
    isStatic: false,
    sourceBubbled: false,
    targetBubbled: false,
    eolAt: null,
    createdAt: '2026-09-22T00:00:00.000Z',
  };
}

const SYSTEMS = [
  systemNode(NODE_A, SYSTEM_A),
  systemNode(NODE_B, SYSTEM_B),
  systemNode(NODE_C, SYSTEM_C),
];
const CONNECTIONS = [
  connection(HOLE_AB, NODE_A, NODE_B, 'wh'),
  connection(GATE_BC, NODE_B, NODE_C, 'stargate'),
];

function entry(characterId: number, characterName: string, systemId: number): MapPresenceEntry {
  return {
    characterId,
    characterName,
    userId: 1,
    mainCharacterId: ME,
    mainCharacterName: 'Me',
    systemId,
    systemName: null,
    systemSecurity: null,
    systemTrueSec: null,
    shipTypeId: null,
    shipTypeName: null,
    shipClass: null,
    shipName: null,
    locationAt: '2026-09-22T00:00:00.000Z',
  };
}

/** A `characterUpdate` frame moving one pilot to `systemId`. */
function moveFrame(characterId: number, characterName: string, systemId: number): MessageEvent {
  return {
    data: {
      type: 'message',
      envelope: {
        task: 'characterUpdate',
        mapId: MAP_ID,
        load: {
          characterId,
          characterName,
          userId: 1,
          mainCharacterId: ME,
          mainCharacterName: 'Me',
          online: true,
          systemId,
          systemName: null,
          systemSecurity: null,
          systemTrueSec: null,
          shipTypeId: null,
          shipTypeName: null,
          shipClass: null,
          shipName: null,
          locationAt: '2026-09-22T00:01:00.000Z',
        },
      },
    },
  } as MessageEvent;
}

describe('WatchedConnectionSoundBridge', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mapId: string;

  function mount(initial: MapPresenceEntry[]) {
    act(() => {
      root.render(
        <RealtimeProvider>
          <MapPresenceProvider initial={initial} mapId={String(MAP_ID)}>
            <MapActiveCharProvider viewerCharacters={[{ id: ME, name: 'Me' }]} mainCharacterId={ME}>
              <WatchedConnectionSoundBridge
                mapId={mapId}
                systems={SYSTEMS}
                connections={CONNECTIONS}
                viewerCharacterIds={[ME]}
              />
            </MapActiveCharProvider>
          </MapPresenceProvider>
        </RealtimeProvider>,
      );
    });
  }

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    lastPort = null;
    play.mockClear();
    localStorage.clear();
    mapId = `map-${++mapCounter}`;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('plays the inbound variant when the jump ends in my system', () => {
    toggleConnectionWatch(mapId, HOLE_AB);
    mount([entry(ME, 'Me', SYSTEM_B), entry(FOREIGN, 'Foreign', SYSTEM_A)]);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_B)));
    expect(play.mock.calls).toEqual([['watchedJump', { variant: 'inbound' }]]);
  });

  it('plays the outbound variant when the jump starts in my system', () => {
    toggleConnectionWatch(mapId, HOLE_AB);
    mount([entry(ME, 'Me', SYSTEM_A), entry(FOREIGN, 'Foreign', SYSTEM_A)]);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_B)));
    expect(play.mock.calls).toEqual([['watchedJump', { variant: 'outbound' }]]);
  });

  it('plays the plain variant when I sit at neither end', () => {
    toggleConnectionWatch(mapId, HOLE_AB);
    mount([entry(ME, 'Me', SYSTEM_C), entry(FOREIGN, 'Foreign', SYSTEM_A)]);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_B)));
    expect(play.mock.calls).toEqual([['watchedJump', { variant: 'plain' }]]);
  });

  it('stays silent for a jump through a hole I do not watch', () => {
    mount([entry(ME, 'Me', SYSTEM_A), entry(FOREIGN, 'Foreign', SYSTEM_A)]);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_B)));
    expect(play).not.toHaveBeenCalled();
  });

  it("stays silent for the viewer's own character", () => {
    toggleConnectionWatch(mapId, HOLE_AB);
    mount([entry(ME, 'Me', SYSTEM_A)]);
    act(() => lastPort?.onmessage?.(moveFrame(ME, 'Me', SYSTEM_B)));
    expect(play).not.toHaveBeenCalled();
  });

  it('stays silent for a jump that crosses no watched connection', () => {
    toggleConnectionWatch(mapId, HOLE_AB);
    mount([entry(ME, 'Me', SYSTEM_B), entry(FOREIGN, 'Foreign', SYSTEM_B)]);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_C)));
    expect(play).not.toHaveBeenCalled();
  });

  it('uses my post-jump system when my move and the watched jump land in one frame', () => {
    // I jump A → B and a foreign pilot follows through the same watched hole,
    // both folded before React re-renders. The cue is inbound, not outbound.
    toggleConnectionWatch(mapId, HOLE_AB);
    mount([entry(ME, 'Me', SYSTEM_A), entry(FOREIGN, 'Foreign', SYSTEM_A)]);
    act(() => {
      lastPort?.onmessage?.(moveFrame(ME, 'Me', SYSTEM_B));
      lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_B));
    });
    expect(play.mock.calls).toEqual([['watchedJump', { variant: 'inbound' }]]);
  });
});
