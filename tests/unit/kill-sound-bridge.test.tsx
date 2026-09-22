import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SOUND_COALESCE_MS,
  createSoundEngine,
  type SoundBackend,
  type SoundEngine,
} from '@/lib/sounds/engine';
import { BUILT_IN_SOUND_IDS, resolveSoundPrefs, type SoundId } from '@/lib/sounds/prefs';

// The bridge resolves the engine at event time, so the real engine can stand
// behind it on a fake backend: the coalescing the burst case asks about is the
// engine's, and a spy in its place would never exercise it.
let engine!: SoundEngine;
vi.mock('@/lib/sounds/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sounds/engine')>();
  return { ...actual, getSoundEngine: () => engine };
});

import { KillSoundBridge } from '@/components/map/KillSoundBridge';
import { RealtimeProvider } from '@/lib/realtime/useRealtime';

const MAP_ID = 7;
const OTHER_MAP_ID = 8;
const SYSTEM_ID = 31000001;

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

let played: SoundId[] = [];
let clock = 0;

function fakeBackend(): SoundBackend {
  const known = new Set<string>(BUILT_IN_SOUND_IDS);
  return {
    isUnlocked: () => true,
    unlock: async () => true,
    has: (soundId) => known.has(soundId),
    play: (soundId) => void played.push(soundId),
  };
}

function killFrame(mapId = MAP_ID): MessageEvent {
  return {
    data: {
      type: 'message',
      envelope: {
        task: 'systemNotification',
        mapId,
        load: {
          mapId,
          systemId: SYSTEM_ID,
          kind: 'killmail',
          killmail: {
            killmailId: 123456,
            shipTypeId: 670,
            totalValue: 1_000_000,
            href: 'https://zkillboard.com/kill/123456/',
          },
        },
      },
    },
  } as MessageEvent;
}

function pingFrame(): MessageEvent {
  return {
    data: {
      type: 'message',
      envelope: {
        task: 'systemNotification',
        mapId: MAP_ID,
        load: { mapId: MAP_ID, systemId: SYSTEM_ID, kind: 'ping' },
      },
    },
  } as MessageEvent;
}

describe('KillSoundBridge', () => {
  let container: HTMLDivElement;
  let root: Root;

  function mount() {
    act(() => {
      root.render(
        <RealtimeProvider>
          <KillSoundBridge mapId={String(MAP_ID)} />
        </RealtimeProvider>,
      );
    });
  }

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    lastPort = null;
    played = [];
    clock = 0;
    localStorage.clear();

    const prefs = resolveSoundPrefs(null);
    prefs.enabled = true;
    prefs.events.killInSystem.enabled = true;
    engine = createSoundEngine({
      backend: fakeBackend(),
      election: null,
      now: () => clock,
      bindGestures: false,
    });
    engine.setPrefs(prefs);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    engine.dispose();
    vi.unstubAllGlobals();
  });

  it('plays the kill cue for a killmail on the open map', () => {
    mount();
    act(() => lastPort?.onmessage?.(killFrame()));
    expect(played).toEqual(['alarm']);
  });

  it('plays once for a same-tick burst of kills', () => {
    mount();
    act(() => {
      lastPort?.onmessage?.(killFrame());
      lastPort?.onmessage?.(killFrame());
      lastPort?.onmessage?.(killFrame());
    });
    expect(played).toEqual(['alarm']);
  });

  it('plays again once the coalesce window has passed', () => {
    mount();
    act(() => lastPort?.onmessage?.(killFrame()));
    clock += SOUND_COALESCE_MS;
    act(() => lastPort?.onmessage?.(killFrame()));
    expect(played).toEqual(['alarm', 'alarm']);
  });

  it('stays silent for a ping', () => {
    mount();
    act(() => lastPort?.onmessage?.(pingFrame()));
    expect(played).toEqual([]);
  });

  it('stays silent for a notification scoped to another map', () => {
    mount();
    act(() => lastPort?.onmessage?.(killFrame(OTHER_MAP_ID)));
    expect(played).toEqual([]);
  });
});
