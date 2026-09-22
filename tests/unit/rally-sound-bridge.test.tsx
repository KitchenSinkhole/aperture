import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

import { RallySoundBridge } from '@/components/map/RallySoundBridge';
import { RealtimeProvider } from '@/lib/realtime/useRealtime';

const MAP_ID = 7;
const OTHER_MAP_ID = 8;

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
    onStateChange: () => () => {},
    has: (soundId) => known.has(soundId),
    load: async (soundId) => known.has(soundId),
    play: (soundId) => void played.push(soundId),
  };
}

let nextEventId = 1;

function systemUpdatedFrame(
  patch: Record<string, unknown>,
  mapId = MAP_ID,
): MessageEvent {
  return {
    data: {
      type: 'message',
      envelope: {
        task: 'mapUpdate',
        mapId,
        load: {
          mapId,
          kind: 'system.updated',
          data: { kind: 'system.updated', eventId: nextEventId++, id: '42', ...patch },
        },
      },
    },
  } as MessageEvent;
}

const RALLY_AT = '2026-09-22T12:00:00.000Z';

describe('RallySoundBridge', () => {
  let container: HTMLDivElement;
  let root: Root;

  function mount() {
    act(() => {
      root.render(
        <RealtimeProvider>
          <RallySoundBridge mapId={String(MAP_ID)} />
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
    prefs.events.rallySet.enabled = true;
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

  it('plays the rally cue when a rally is set on the open map', () => {
    mount();
    act(() => lastPort?.onmessage?.(systemUpdatedFrame({ rallyAt: RALLY_AT })));
    expect(played).toEqual(['bell']);
  });

  it('stays silent when a rally is cleared', () => {
    mount();
    act(() => lastPort?.onmessage?.(systemUpdatedFrame({ rallyAt: null })));
    expect(played).toEqual([]);
  });

  it('stays silent for a system update that does not touch the rally', () => {
    mount();
    act(() => lastPort?.onmessage?.(systemUpdatedFrame({ alias: 'Home' })));
    expect(played).toEqual([]);
  });

  it('stays silent for an update on another map', () => {
    mount();
    act(() => lastPort?.onmessage?.(systemUpdatedFrame({ rallyAt: RALLY_AT }, OTHER_MAP_ID)));
    expect(played).toEqual([]);
  });
});
