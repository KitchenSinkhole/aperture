import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MapPresenceProvider,
  PresenceStore,
  usePresenceForMap,
} from '@/components/map/MapPresenceContext';
import type { MapPresenceEntry } from '@/lib/map/loadMap';
import type { CharacterUpdateLoad } from '@/lib/realtime/protocol';
import { RealtimeProvider, useBlackoutStatus } from '@/lib/realtime/useRealtime';
import type { BlackoutStatus } from '@/types';

const MAP_ID = 7;
const ME = 1;
const OTHER = 2;
const SINCE = '2026-10-23T12:00:00.000Z';

const OFF: BlackoutStatus = { active: false, since: null, cleared: false };
const ON_RESTRICTED: BlackoutStatus = { active: true, since: SINCE, cleared: false };
const ON_CLEARED: BlackoutStatus = { active: true, since: SINCE, cleared: true };

function entry(characterId: number, userId: number, systemId: number): MapPresenceEntry {
  return {
    characterId,
    characterName: `Pilot ${characterId}`,
    userId,
    mainCharacterId: null,
    mainCharacterName: null,
    systemId,
    systemName: null,
    systemSecurity: null,
    systemTrueSec: null,
    shipTypeId: null,
    shipTypeName: null,
    shipClass: null,
    shipName: null,
    locationAt: '2026-10-23T11:00:00.000Z',
  };
}

function update(characterId: number, userId: number, systemId: number): CharacterUpdateLoad {
  return {
    characterId,
    characterName: `Pilot ${characterId}`,
    userId,
    mainCharacterId: null,
    mainCharacterName: null,
    online: true,
    systemId,
    systemName: null,
    systemSecurity: null,
    systemTrueSec: null,
    shipTypeId: null,
    shipTypeName: null,
    shipClass: null,
    shipName: null,
    locationAt: '2026-10-23T13:00:00.000Z',
  };
}

const ROSTER = [entry(100, ME, 31000005), entry(101, ME, 30000142), entry(200, OTHER, 31000005)];

describe('PresenceStore.pruneToAccount', () => {
  it("keeps only the given account's entries", () => {
    const store = new PresenceStore();
    store.seed(ROSTER);
    store.pruneToAccount(ME);
    expect(store.getAll().map((e) => e.characterId)).toEqual([100, 101]);
    expect(store.getForSystem(31000005).map((e) => e.characterId)).toEqual([100]);
    expect(store.getSystemForCharacter(200)).toBeNull();
  });
});

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

function frame(task: string, load: unknown, mapId?: number): MessageEvent {
  return { data: { type: 'message', envelope: { task, load, mapId } } } as MessageEvent;
}

function healthCheck(blackout?: BlackoutStatus): MessageEvent {
  return frame('healthCheck', { ts: Date.now(), ...(blackout ? { blackout } : {}) });
}

let seenIds: number[] = [];
let seenBlackout: BlackoutStatus | null = null;

function Probe() {
  const roster = usePresenceForMap();
  useEffect(() => {
    seenIds = roster.map((e) => e.characterId);
  }, [roster]);
  return null;
}

function Harness({ initial }: { initial: BlackoutStatus }) {
  const blackout = useBlackoutStatus(initial);
  useEffect(() => {
    seenBlackout = blackout;
  }, [blackout]);
  return (
    <MapPresenceProvider
      initial={ROSTER}
      mapId={String(MAP_ID)}
      blackout={blackout}
      viewerUserId={ME}
    >
      <Probe />
    </MapPresenceProvider>
  );
}

describe('Blackout presence pruning', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    lastPort = null;
    seenIds = [];
    seenBlackout = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function mount(initial: BlackoutStatus) {
    act(() => {
      root.render(
        <RealtimeProvider>
          <Harness initial={initial} />
        </RealtimeProvider>,
      );
    });
  }

  function send(e: MessageEvent) {
    act(() => lastPort!.onmessage!(e));
  }

  it('seeds the standing from the initial state until a healthCheck arrives', () => {
    mount(ON_CLEARED);
    expect(seenBlackout).toEqual(ON_CLEARED);
    send(healthCheck(OFF));
    expect(seenBlackout).toEqual(OFF);
  });

  it('keeps the current standing on a healthCheck without blackout', () => {
    mount(OFF);
    send(healthCheck(ON_CLEARED));
    send(healthCheck());
    expect(seenBlackout).toEqual(ON_CLEARED);
  });

  it('prunes to the viewer account when Blackout goes on and the viewer is not cleared', () => {
    mount(OFF);
    expect(seenIds).toEqual([100, 101, 200]);
    send(healthCheck(ON_RESTRICTED));
    expect(seenIds).toEqual([100, 101]);
  });

  it('prunes on mount when the initial state already restricts the viewer', () => {
    mount(ON_RESTRICTED);
    expect(seenIds).toEqual([100, 101]);
  });

  it('never prunes a cleared viewer', () => {
    mount(OFF);
    send(healthCheck(ON_CLEARED));
    expect(seenIds).toEqual([100, 101, 200]);
    send(frame('characterUpdate', update(201, OTHER, 30000142), MAP_ID));
    expect(seenIds).toEqual([100, 101, 200, 201]);
  });

  it('repopulates from later characterUpdates once Blackout goes off', () => {
    mount(ON_RESTRICTED);
    expect(seenIds).toEqual([100, 101]);
    send(healthCheck(OFF));
    expect(seenIds).toEqual([100, 101]);
    send(frame('characterUpdate', update(200, OTHER, 31000005), MAP_ID));
    expect(seenIds).toEqual([100, 101, 200]);
  });
});
