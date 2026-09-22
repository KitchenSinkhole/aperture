import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILT_IN_SOUNDS,
  SOUND_EVENT_LABELS,
  defaultSoundForEvent,
  getBuiltInSound,
  soundFilesFor,
  voiceSoundsForEvent,
  type ChimeSound,
} from '@/lib/sounds/catalog';
import {
  SOUND_COALESCE_MS,
  createSoundEngine,
  createWebAudioBackend,
  type SoundBackend,
  type SoundLeaderElection,
} from '@/lib/sounds/engine';
import { SOUND_MUTED_KEY, writeSoundMuted } from '@/lib/sounds/mutePrefs';
import {
  BUILT_IN_SOUND_IDS,
  CHIME_SOUND_IDS,
  DEFAULT_SOUND_PREFS,
  SOUND_EVENTS,
  VOICE_PACKS,
  VOICE_SOUND_IDS,
  resolveSoundPrefs,
  type SoundEvent,
  type SoundId,
  type SoundPrefs,
  type SoundVariant,
} from '@/lib/sounds/prefs';

const CUSTOM_ID = 'custom:2f1c9e40-5a3b-4c1d-9e88-77b1a0c3de55';

type PlayCall = { soundId: SoundId; gain: number; variant: SoundVariant };

type FakeBackend = SoundBackend & {
  calls: PlayCall[];
  loads: SoundId[];
  register(soundId: SoundId): void;
};

/**
 * `loadable` stands in for a file-backed sound: absent until something loads
 * it, the way a voice line is absent until it is fetched and decoded.
 */
function fakeBackend(
  opts: { unlocked?: boolean; unlockable?: boolean; loadable?: readonly SoundId[] } = {},
): FakeBackend {
  const known = new Set<string>(CHIME_SOUND_IDS);
  const loadable = new Set<string>(opts.loadable ?? []);
  let unlocked = opts.unlocked ?? true;
  const calls: PlayCall[] = [];
  const loads: SoundId[] = [];
  return {
    calls,
    loads,
    register: (soundId) => void known.add(soundId),
    isUnlocked: () => unlocked,
    unlock: async () => {
      unlocked = opts.unlockable ?? true;
      return unlocked;
    },
    has: (soundId) => known.has(soundId),
    load: async (soundId) => {
      loads.push(soundId);
      if (known.has(soundId)) return true;
      if (!loadable.has(soundId)) return false;
      // A file-backed sound lands a tick later, never within the call.
      await Promise.resolve();
      known.add(soundId);
      return true;
    },
    play: (soundId, gain, variant) => void calls.push({ soundId, gain, variant }),
  };
}

/** One in-process broker standing in for the Web Locks queue. */
function fakeElection(): SoundLeaderElection {
  const queues = new Map<string, Array<(isLeader: boolean) => void>>();
  return {
    claim(key, onChange) {
      const queue = queues.get(key) ?? [];
      queues.set(key, queue);
      queue.push(onChange);
      if (queue[0] === onChange) onChange(true);
      return () => {
        const index = queue.indexOf(onChange);
        if (index < 0) return;
        queue.splice(index, 1);
        onChange(false);
        if (index === 0) queue[0]?.(true);
      };
    },
  };
}

function allOn(overrides: Partial<SoundPrefs> = {}): SoundPrefs {
  const prefs = resolveSoundPrefs(null);
  prefs.enabled = true;
  for (const event of SOUND_EVENTS) prefs.events[event].enabled = true;
  return { ...prefs, ...overrides };
}

describe('sound engine gates', () => {
  beforeEach(() => {
    localStorage.clear();
    writeSoundMuted(false);
  });

  it('plays an enabled event at the configured volume', () => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.setPrefs(allOn({ volume: 0.4 }));
    engine.play('pilotArrived');
    expect(backend.calls).toEqual([{ soundId: 'chime-up', gain: 0.4, variant: 'plain' }]);
  });

  it('passes the variant through to the backend', () => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.setPrefs(allOn());
    engine.play('watchedJump', { variant: 'inbound' });
    expect(backend.calls[0]?.variant).toBe('inbound');
  });

  it('is a no-op while the browser has not unlocked audio', () => {
    const backend = fakeBackend({ unlocked: false });
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.setPrefs(allOn());
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(0);
  });

  it('is a no-op while muted', () => {
    writeSoundMuted(true);
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.setPrefs(allOn());
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(0);
  });

  it('is a no-op when the master switch is off', () => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.setPrefs(allOn({ enabled: false }));
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(0);
  });

  it('is a no-op when only that event is disabled', () => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    const prefs = allOn();
    prefs.events.pilotArrived.enabled = false;
    engine.setPrefs(prefs);
    engine.play('pilotArrived');
    engine.play('pilotLeft');
    expect(backend.calls.map((c) => c.soundId)).toEqual(['chime-down']);
  });

  it('is a no-op with no prefs set, since everything defaults off', () => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(0);
  });

  it('unlocks on the first document gesture', async () => {
    const backend = fakeBackend({ unlocked: false });
    const engine = createSoundEngine({ backend });
    engine.setPrefs(allOn());
    expect(engine.getSnapshot().unlocked).toBe(false);
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await Promise.resolve();
    expect(engine.getSnapshot().unlocked).toBe(true);
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(1);
    engine.dispose();
  });

  it('notifies subscribers when mute changes and keeps the snapshot stable otherwise', () => {
    const engine = createSoundEngine({ backend: fakeBackend(), bindGestures: false });
    const first = engine.getSnapshot();
    expect(engine.getSnapshot()).toBe(first);
    let notified = 0;
    const unsubscribe = engine.subscribe(() => void (notified += 1));
    engine.toggleMute();
    expect(notified).toBe(1);
    expect(engine.getSnapshot().muted).toBe(true);
    unsubscribe();
    engine.dispose();
  });

  it('reports a locked, unmuted server snapshot', () => {
    writeSoundMuted(true);
    const engine = createSoundEngine({ backend: fakeBackend(), bindGestures: false });
    expect(engine.getServerSnapshot()).toEqual({ unlocked: false, muted: false });
  });
});

describe('cross-tab mute', () => {
  beforeEach(() => {
    localStorage.clear();
    writeSoundMuted(false);
  });

  /** What another tab's `writeSoundMuted` looks like from this one. */
  function otherTabWrote(value: string | null): void {
    if (value == null) localStorage.removeItem(SOUND_MUTED_KEY);
    else localStorage.setItem(SOUND_MUTED_KEY, value);
    window.dispatchEvent(new StorageEvent('storage', { key: SOUND_MUTED_KEY, newValue: value }));
  }

  it('silences an already-open engine when another tab mutes', () => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.setPrefs(allOn());
    let notified = 0;
    const unsubscribe = engine.subscribe(() => void (notified += 1));

    otherTabWrote('1');

    expect(engine.getSnapshot().muted).toBe(true);
    expect(notified).toBe(1);
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(0);
    unsubscribe();
    engine.dispose();
  });

  it('unmutes an already-open engine when another tab unmutes', () => {
    writeSoundMuted(true);
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.setPrefs(allOn());

    otherTabWrote('0');

    expect(engine.getSnapshot().muted).toBe(false);
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(1);
    engine.dispose();
  });

  it('ignores a storage event for an unrelated key', () => {
    const engine = createSoundEngine({ backend: fakeBackend(), bindGestures: false });
    let notified = 0;
    const unsubscribe = engine.subscribe(() => void (notified += 1));

    localStorage.setItem('aperture:unrelated', '1');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'aperture:unrelated', newValue: '1' }),
    );

    expect(notified).toBe(0);
    expect(engine.getSnapshot().muted).toBe(false);
    unsubscribe();
    engine.dispose();
  });
});

describe('sound id resolution', () => {
  beforeEach(() => {
    localStorage.clear();
    writeSoundMuted(false);
  });

  it.each([
    ['an unknown id', 'foghorn' as SoundId],
    ['a custom id with no registered buffer', CUSTOM_ID as SoundId],
  ])('falls back to the event default for %s', (_label, soundId) => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    const prefs = allOn();
    prefs.events.killInSystem.sound = soundId;
    engine.setPrefs(prefs);
    engine.play('killInSystem');
    expect(backend.calls[0]?.soundId).toBe(defaultSoundForEvent('killInSystem'));
  });

  it('uses a custom id once its buffer is registered', () => {
    const backend = fakeBackend();
    backend.register(CUSTOM_ID);
    const engine = createSoundEngine({ backend, bindGestures: false });
    const prefs = allOn();
    prefs.events.killInSystem.sound = CUSTOM_ID;
    engine.setPrefs(prefs);
    engine.play('killInSystem');
    expect(backend.calls[0]?.soundId).toBe(CUSTOM_ID);
  });
});

describe('coalescing', () => {
  beforeEach(() => {
    localStorage.clear();
    writeSoundMuted(false);
  });

  function engineWithClock() {
    const backend = fakeBackend();
    let clock = 1_000;
    const engine = createSoundEngine({ backend, bindGestures: false, now: () => clock });
    engine.setPrefs(allOn());
    return { backend, engine, advance: (ms: number) => void (clock += ms) };
  }

  it('drops a repeat of the same event inside the window', () => {
    const { backend, engine, advance } = engineWithClock();
    engine.play('pilotArrived');
    advance(SOUND_COALESCE_MS - 1);
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(1);
  });

  it('lets a different event through inside the window', () => {
    const { backend, engine, advance } = engineWithClock();
    engine.play('pilotArrived');
    advance(10);
    engine.play('pilotLeft');
    expect(backend.calls.map((c) => c.soundId)).toEqual(['chime-up', 'chime-down']);
  });

  it('plays again once the window has passed', () => {
    const { backend, engine, advance } = engineWithClock();
    engine.play('pilotArrived');
    advance(SOUND_COALESCE_MS);
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(2);
  });

  it('does not start the window on a play a gate blocked', () => {
    const { backend, engine, advance } = engineWithClock();
    engine.setMuted(true);
    engine.play('pilotArrived');
    engine.setMuted(false);
    advance(10);
    engine.play('pilotArrived');
    expect(backend.calls).toHaveLength(1);
  });
});

describe('leader election', () => {
  beforeEach(() => {
    localStorage.clear();
    writeSoundMuted(false);
  });

  function tab(election: SoundLeaderElection | null, mapId: string | null) {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, election, bindGestures: false });
    engine.setPrefs(allOn());
    engine.setMapId(mapId);
    return { backend, engine };
  }

  it('lets only the first tab on a map play', () => {
    const election = fakeElection();
    const a = tab(election, 'map-1');
    const b = tab(election, 'map-1');
    a.engine.play('pilotArrived');
    b.engine.play('pilotArrived');
    expect(a.backend.calls).toHaveLength(1);
    expect(b.backend.calls).toHaveLength(0);
  });

  it('does not silence a tab on a different map', () => {
    const election = fakeElection();
    const a = tab(election, 'map-1');
    const b = tab(election, 'map-2');
    a.engine.play('pilotArrived');
    b.engine.play('pilotArrived');
    expect(a.backend.calls).toHaveLength(1);
    expect(b.backend.calls).toHaveLength(1);
  });

  it('passes leadership on when the holder releases', () => {
    const election = fakeElection();
    const a = tab(election, 'map-1');
    const b = tab(election, 'map-1');
    a.engine.dispose();
    b.engine.play('pilotArrived');
    expect(b.backend.calls).toHaveLength(1);
  });

  it('releases the old map when the tab switches maps', () => {
    const election = fakeElection();
    const a = tab(election, 'map-1');
    const b = tab(election, 'map-1');
    a.engine.setMapId('map-2');
    b.engine.play('pilotArrived');
    a.engine.play('pilotArrived');
    expect(b.backend.calls).toHaveLength(1);
    expect(a.backend.calls).toHaveLength(1);
  });

  it('plays unconditionally where no election is available', () => {
    const a = tab(null, 'map-1');
    const b = tab(null, 'map-1');
    a.engine.play('pilotArrived');
    b.engine.play('pilotArrived');
    expect(a.backend.calls).toHaveLength(1);
    expect(b.backend.calls).toHaveLength(1);
  });
});

describe('preview', () => {
  beforeEach(() => {
    localStorage.clear();
    writeSoundMuted(false);
  });

  it('plays while muted and with the master switch off', () => {
    writeSoundMuted(true);
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.setPrefs(allOn({ enabled: false, volume: 0.9 }));
    engine.preview('alarm');
    expect(backend.calls).toEqual([{ soundId: 'alarm', gain: 0.9, variant: 'plain' }]);
  });

  it('plays without leadership', () => {
    const election = fakeElection();
    const holder = createSoundEngine({ backend: fakeBackend(), election, bindGestures: false });
    holder.setMapId('map-1');
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, election, bindGestures: false });
    engine.setMapId('map-1');
    engine.preview('tick');
    expect(backend.calls).toHaveLength(1);
    holder.dispose();
    engine.dispose();
  });

  it('ignores coalescing', () => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false, now: () => 1_000 });
    engine.preview('tick');
    engine.preview('tick');
    expect(backend.calls).toHaveLength(2);
  });

  it('unlocks first and then plays when audio is still locked', async () => {
    const backend = fakeBackend({ unlocked: false });
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.preview('chime-up');
    expect(backend.calls).toHaveLength(0);
    await Promise.resolve();
    expect(backend.calls).toHaveLength(1);
    expect(engine.getSnapshot().unlocked).toBe(true);
  });

  it('drops an unknown sound id', () => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.preview('foghorn' as SoundId);
    expect(backend.calls).toHaveLength(0);
  });
});

describe('built-in catalog', () => {
  /** Minimal stand-in for `BaseAudioContext` — jsdom has no Web Audio. */
  function fakeAudioContext(sampleRate = 44_100) {
    return {
      sampleRate,
      createBuffer(channels: number, length: number, rate: number) {
        const data = new Float32Array(length);
        return {
          numberOfChannels: channels,
          length,
          sampleRate: rate,
          getChannelData: () => data,
        };
      },
    } as unknown as BaseAudioContext;
  }

  it('covers every built-in id exactly once', () => {
    expect(BUILT_IN_SOUNDS.map((s) => s.id)).toEqual([...BUILT_IN_SOUND_IDS]);
  });

  it.each([...CHIME_SOUND_IDS])('synthesizes audible, in-range samples for %s', (id) => {
    const entry = getBuiltInSound(id);
    expect(entry?.kind).toBe('chime');
    const buffer = (entry as ChimeSound).synth(fakeAudioContext());
    const samples = buffer.getChannelData(0);
    expect(buffer.length).toBeGreaterThan(0);
    let peak = 0;
    for (const sample of samples) {
      expect(Number.isFinite(sample)).toBe(true);
      peak = Math.max(peak, Math.abs(sample));
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('starts and ends near silence so nothing clicks', () => {
    const chimeUp = getBuiltInSound('chime-up') as ChimeSound;
    const samples = chimeUp.synth(fakeAudioContext()).getChannelData(0);
    expect(Math.abs(samples[0] ?? 1)).toBeLessThan(0.01);
    expect(Math.abs(samples[samples.length - 1] ?? 1)).toBeLessThan(0.05);
  });

  it('defaults every event to a chime with a label', () => {
    for (const event of SOUND_EVENTS) {
      expect(getBuiltInSound(defaultSoundForEvent(event))?.kind).toBe('chime');
      expect(SOUND_EVENT_LABELS[event].label.length).toBeGreaterThan(0);
    }
  });

  it('maps each event to its documented default chime', () => {
    const expected: Record<SoundEvent, SoundId> = {
      pilotArrived: 'chime-up',
      pilotLeft: 'chime-down',
      watchedJump: 'tick',
      killInSystem: 'alarm',
      rallySet: 'bell',
      systemPinged: 'ping',
    };
    for (const event of SOUND_EVENTS) {
      expect(DEFAULT_SOUND_PREFS.events[event].sound).toBe(expected[event]);
    }
  });
});

/** Lets a deferred `load` and the `.then` that follows it run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('voice packs', () => {
  const ADA_WATCHED = 'voice-ada-watchedJump' as SoundId;
  const ADA_ARRIVED = 'voice-ada-pilotArrived' as SoundId;

  beforeEach(() => {
    localStorage.clear();
    writeSoundMuted(false);
  });

  it('offers exactly one option per pack for each event', () => {
    for (const event of SOUND_EVENTS) {
      const voices = voiceSoundsForEvent(event);
      expect(voices.map((v) => v.pack)).toEqual(VOICE_PACKS.map((p) => p.id));
      for (const voice of voices) {
        expect(voice.event).toBe(event);
        expect(voice.label).toBe(VOICE_PACKS.find((p) => p.id === voice.pack)?.label);
      }
    }
  });

  it('catalogues every voice id and ships the file it names', () => {
    for (const id of VOICE_SOUND_IDS) {
      const entry = getBuiltInSound(id);
      expect(entry?.kind).toBe('voice');
      const files = soundFilesFor(id);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(existsSync(join(process.cwd(), 'public', file)), file).toBe(true);
      }
    }
  });

  it('splits the watched-jump line by variant and shares one file elsewhere', () => {
    for (const pack of VOICE_PACKS) {
      for (const event of SOUND_EVENTS) {
        const files = soundFilesFor(`voice-${pack.id}-${event}` as SoundId);
        expect(files).toHaveLength(event === 'watchedJump' ? 3 : 1);
      }
    }
  });

  it('prefetches the sound of every enabled event and nothing else', () => {
    const backend = fakeBackend({ loadable: VOICE_SOUND_IDS as readonly SoundId[] });
    const engine = createSoundEngine({ backend, bindGestures: false });
    const prefs = resolveSoundPrefs(null);
    prefs.enabled = true;
    prefs.events.pilotArrived.enabled = true;
    prefs.events.pilotArrived.sound = ADA_ARRIVED;
    prefs.events.pilotLeft.sound = 'voice-cowboy-pilotLeft' as SoundId;
    engine.setPrefs(prefs);
    expect(backend.loads).toEqual([ADA_ARRIVED]);
  });

  it('chimes until the file lands, then uses the voice line', async () => {
    const backend = fakeBackend({ loadable: [ADA_ARRIVED] });
    let clock = 0;
    const engine = createSoundEngine({ backend, bindGestures: false, now: () => clock });
    const prefs = allOn();
    prefs.events.pilotArrived.sound = ADA_ARRIVED;
    engine.setPrefs(prefs);

    // A cue landing before the prefetch resolves is what the fallback covers.
    engine.play('pilotArrived');
    expect(backend.calls.at(-1)?.soundId).toBe('chime-up');
    expect(backend.loads).toContain(ADA_ARRIVED);

    await settle();
    clock += SOUND_COALESCE_MS;
    engine.play('pilotArrived');
    expect(backend.calls.at(-1)?.soundId).toBe(ADA_ARRIVED);
  });

  it('falls back to the event chime for a sound it cannot produce', () => {
    const backend = fakeBackend();
    const engine = createSoundEngine({ backend, bindGestures: false });
    const prefs = allOn();
    prefs.events.killInSystem.sound = ADA_ARRIVED;
    engine.setPrefs(prefs);
    engine.play('killInSystem');
    expect(backend.calls.at(-1)?.soundId).toBe('alarm');
  });

  it('passes the watched-jump variant through to the backend', async () => {
    const backend = fakeBackend({ loadable: [ADA_WATCHED] });
    const engine = createSoundEngine({ backend, bindGestures: false });
    const prefs = allOn();
    prefs.events.watchedJump.sound = ADA_WATCHED;
    engine.setPrefs(prefs);
    await settle();
    engine.play('watchedJump', { variant: 'inbound' });
    expect(backend.calls.at(-1)).toMatchObject({ soundId: ADA_WATCHED, variant: 'inbound' });
  });

  it('loads an unfetched sound before previewing it', async () => {
    const backend = fakeBackend({ loadable: [ADA_WATCHED] });
    const engine = createSoundEngine({ backend, bindGestures: false });
    engine.preview(ADA_WATCHED);
    expect(backend.calls).toHaveLength(0);
    await settle();
    expect(backend.calls.at(-1)).toMatchObject({ soundId: ADA_WATCHED, variant: 'plain' });
  });
});

/**
 * jsdom has no Web Audio, so the backend's imported-sound path runs against a
 * context that decodes anything into a stand-in buffer.
 */
class FakeAudioContext {
  state = 'running';
  destination = {};
  createGain() {
    return { gain: { value: 1 }, connect: () => {} };
  }
  async decodeAudioData(): Promise<AudioBuffer> {
    return { duration: 1 } as AudioBuffer;
  }
}

/** A device store whose byte reads settle only when the test says so. */
function customSourceDouble() {
  const listeners = new Set<() => void>();
  const waiting: ((bytes: ArrayBuffer | null) => void)[] = [];
  let reads = 0;
  return {
    get reads(): number {
      return reads;
    },
    source: {
      bytesFor: () => {
        reads += 1;
        return new Promise<ArrayBuffer | null>((resolve) => void waiting.push(resolve));
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
    deliver: (bytes: ArrayBuffer | null) => waiting.shift()?.(bytes),
  };
}

describe('createWebAudioBackend — imported sounds', () => {
  beforeEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  });

  it('caches a load the device store did not change under', async () => {
    const store = customSourceDouble();
    const backend = createWebAudioBackend({ customSounds: store.source });

    const loading = backend.load(CUSTOM_ID);
    store.deliver(new ArrayBuffer(8));

    expect(await loading).toBe(true);
    expect(backend.has(CUSTOM_ID)).toBe(true);
  });

  it('discards a load the user deleted the sound under', async () => {
    const store = customSourceDouble();
    const backend = createWebAudioBackend({ customSounds: store.source });

    const loading = backend.load(CUSTOM_ID);
    // The delete lands while the bytes are still in flight.
    store.notify();
    store.deliver(new ArrayBuffer(8));

    expect(await loading).toBe(false);
    expect(backend.has(CUSTOM_ID)).toBe(false);
  });

  it('does not strand a read as failed when the store changed under it', async () => {
    const store = customSourceDouble();
    const backend = createWebAudioBackend({ customSounds: store.source });

    const loading = backend.load(CUSTOM_ID);
    store.notify();
    store.deliver(null);
    expect(await loading).toBe(false);

    // Nothing was memoized against the id, so the next cue reads the store again.
    const retried = backend.load(CUSTOM_ID);
    store.deliver(new ArrayBuffer(8));
    expect(await retried).toBe(true);
    expect(store.reads).toBe(2);
  });
});
