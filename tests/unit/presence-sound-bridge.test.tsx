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
import { PresenceSoundBridge } from '@/components/map/PresenceSoundBridge';
import { toggleConnectionWatch } from '@/lib/connectionWatchPrefs';
import type { MapConnectionEdge, MapPresenceEntry, MapSystemNode } from '@/lib/map/loadMap';
import { RealtimeProvider } from '@/lib/realtime/useRealtime';

const MAP_ID = 7;
const SYSTEM_A = 31000001;
const SYSTEM_B = 31000002;
const SYSTEM_C = 31000003;
const ME = 100;
const FOREIGN = 200;
const HOLE_AC = 'hole-ac';

const SYSTEMS = [
  { id: 'node-a', systemId: SYSTEM_A },
  { id: 'node-b', systemId: SYSTEM_B },
  { id: 'node-c', systemId: SYSTEM_C },
] as MapSystemNode[];
const CONNECTIONS = [{ id: HOLE_AC, source: 'node-a', target: 'node-c' }] as MapConnectionEdge[];

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

describe('PresenceSoundBridge', () => {
  let container: HTMLDivElement;
  let root: Root;

  function mount(initial: MapPresenceEntry[], watchedJumpOn = false) {
    act(() => {
      root.render(
        <RealtimeProvider>
          <MapPresenceProvider initial={initial} mapId={String(MAP_ID)}>
            <MapActiveCharProvider
              viewerCharacters={[{ id: ME, name: 'Me' }]}
              mainCharacterId={ME}
            >
              <PresenceSoundBridge
                mapId={String(MAP_ID)}
                systems={SYSTEMS}
                connections={CONNECTIONS}
                viewerCharacterIds={[ME]}
                watchedJumpOn={watchedJumpOn}
              />
            </MapActiveCharProvider>
          </MapPresenceProvider>
        </RealtimeProvider>,
      );
    });
  }

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    lastPort = null;
    play.mockClear();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('plays the arrive cue for a foreign pilot jumping into my system', () => {
    mount([entry(ME, 'Me', SYSTEM_A), entry(FOREIGN, 'Foreign', SYSTEM_C)]);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_A)));
    expect(play.mock.calls).toEqual([['pilotArrived']]);
  });

  it('plays the leave cue for a foreign pilot jumping out of my system', () => {
    mount([entry(ME, 'Me', SYSTEM_A), entry(FOREIGN, 'Foreign', SYSTEM_A)]);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_C)));
    expect(play.mock.calls).toEqual([['pilotLeft']]);
  });

  it('classifies against my post-jump system when both moves land in one frame', () => {
    // My pilot and a foreign one both jump A → B, and both envelopes are folded
    // before React can re-render. The foreign pilot followed me into B, so the
    // cue is an arrival — reading "my system" from a render-scoped value would
    // still say A and call it a departure.
    mount([entry(ME, 'Me', SYSTEM_A), entry(FOREIGN, 'Foreign', SYSTEM_A)]);
    act(() => {
      lastPort?.onmessage?.(moveFrame(ME, 'Me', SYSTEM_B));
      lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_B));
    });
    expect(play.mock.calls).toEqual([['pilotArrived']]);
  });

  it('stays silent for a jump between two systems that are not mine', () => {
    mount([entry(ME, 'Me', SYSTEM_A), entry(FOREIGN, 'Foreign', SYSTEM_B)]);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_C)));
    expect(play).not.toHaveBeenCalled();
  });

  it("stays silent for the viewer's own character", () => {
    mount([entry(ME, 'Me', SYSTEM_A)]);
    act(() => lastPort?.onmessage?.(moveFrame(ME, 'Me', SYSTEM_B)));
    expect(play).not.toHaveBeenCalled();
  });

  it('leaves a jump through a watched hole to the watched-jump cue', () => {
    toggleConnectionWatch(String(MAP_ID), HOLE_AC);
    mount([entry(ME, 'Me', SYSTEM_A), entry(FOREIGN, 'Foreign', SYSTEM_C)], true);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_A)));
    expect(play).not.toHaveBeenCalled();
  });

  it('still plays for a watched hole while the watched-jump cue is off', () => {
    toggleConnectionWatch(String(MAP_ID), HOLE_AC);
    mount([entry(ME, 'Me', SYSTEM_A), entry(FOREIGN, 'Foreign', SYSTEM_C)]);
    act(() => lastPort?.onmessage?.(moveFrame(FOREIGN, 'Foreign', SYSTEM_A)));
    expect(play.mock.calls).toEqual([['pilotArrived']]);
  });
});
