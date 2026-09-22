'use client';

import { getBuiltInSound, soundFilesFor } from './catalog';
import { getCustomSoundStore } from './customStore';
import { readSoundMuted, subscribeSoundMuted, writeSoundMuted } from './mutePrefs';
import {
  DEFAULT_SOUND_PREFS,
  SOUND_EVENTS,
  type SoundEvent,
  type SoundId,
  type SoundPrefs,
  type SoundVariant,
} from './prefs';

/**
 * The single owner of audio playback: volume, mute, the browser autoplay
 * unlock, per-map leader election and per-event coalescing. Event sources are
 * renderless bridges that call `play`; nothing else touches Web Audio.
 */

/** Leading-edge window — the first cue of a kind plays, repeats inside it drop. */
export const SOUND_COALESCE_MS = 2000;

/** Prefix of the Web Locks name the per-map leader holds. */
export const SOUND_LEADER_LOCK_PREFIX = 'aperture:sound-leader:';

/** Playback surface the engine drives. Injectable so tests run on a fake. */
export interface SoundBackend {
  /** Whether the browser currently permits playback. */
  isUnlocked(): boolean;
  /** Attempt to obtain permission; resolves with the resulting state. */
  unlock(): Promise<boolean>;
  /** Whether a buffer for this id can be produced right now, without waiting. */
  has(soundId: SoundId): boolean;
  /** Bring this id's buffers in; resolves false when it cannot be produced. */
  load(soundId: SoundId): Promise<boolean>;
  /** Play at 0..1 gain. Never throws. */
  play(soundId: SoundId, gain: number, variant: SoundVariant): void;
}

/** Elects one tab per map to play. Injectable so tests run on a fake. */
export interface SoundLeaderElection {
  /**
   * Claim leadership for `key`. `onChange` reports the current standing and
   * every later change. The returned fn stands down.
   */
  claim(key: string, onChange: (isLeader: boolean) => void): () => void;
}

/** Reference-stable snapshot for `useSyncExternalStore`. */
export type SoundStatus = {
  unlocked: boolean;
  muted: boolean;
};

export interface SoundEngine {
  setPrefs(prefs: SoundPrefs): void;
  setMapId(mapId: string | null): void;
  /** Play an event's cue, subject to every gate. Silent when any gate blocks. */
  play(event: SoundEvent, opts?: { variant?: SoundVariant }): void;
  /** Audition a sound, bypassing the master switch, mute, leadership and coalescing. */
  preview(soundId: SoundId): void;
  /** Ask the browser for playback permission; call from a user gesture. */
  unlock(): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  getSnapshot(): SoundStatus;
  getServerSnapshot(): SoundStatus;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export type SoundEngineDeps = {
  backend: SoundBackend;
  /** `null` (no Web Locks) makes every tab a leader. */
  election?: SoundLeaderElection | null;
  now?: () => number;
  /** Bind `unlock()` to the first document gesture. Defaults to on. */
  bindGestures?: boolean;
};

const SERVER_STATUS: SoundStatus = { unlocked: false, muted: false };

export function createSoundEngine(deps: SoundEngineDeps): SoundEngine {
  const { backend } = deps;
  const election = deps.election ?? null;
  const now = deps.now ?? (() => Date.now());

  let prefs: SoundPrefs = DEFAULT_SOUND_PREFS;
  let mapId: string | null = null;
  // Without an election there is nothing to dedupe against, so every tab plays.
  let isLeader = election == null;
  let standDown: (() => void) | null = null;
  let unlocked = backend.isUnlocked();
  let muted = readSoundMuted();
  let status: SoundStatus = { unlocked, muted };
  const lastPlayedAt = new Map<SoundEvent, number>();
  const listeners = new Set<() => void>();
  const teardown: Array<() => void> = [];

  function publish(): void {
    if (status.unlocked === unlocked && status.muted === muted) return;
    status = { unlocked, muted };
    for (const listener of listeners) listener();
  }

  function applyUnlockResult(ok: boolean): void {
    unlocked = ok;
    publish();
  }

  function unlock(): void {
    if (unlocked) return;
    void backend.unlock().then(applyUnlockResult);
  }

  if (deps.bindGestures !== false && typeof document !== 'undefined') {
    const onGesture = () => unlock();
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    teardown.push(() => {
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
    });
  }

  teardown.push(
    subscribeSoundMuted(() => {
      muted = readSoundMuted();
      publish();
    }),
  );

  function resolveSoundId(event: SoundEvent): SoundId {
    const wanted = prefs.events[event].sound;
    if (backend.has(wanted)) return wanted;
    // A file-backed sound the prefetch missed, or whose fetch failed: try again
    // so the next cue can use it, and chime for this one.
    void backend.load(wanted);
    return DEFAULT_SOUND_PREFS.events[event].sound;
  }

  /** Fetch the files every live cue needs before the cue fires. */
  function prefetch(next: SoundPrefs): void {
    if (!next.enabled) return;
    for (const event of SOUND_EVENTS) {
      const { enabled, sound } = next.events[event];
      if (enabled && !backend.has(sound)) void backend.load(sound);
    }
  }

  function playWhenLoaded(soundId: SoundId): void {
    if (backend.has(soundId)) {
      backend.play(soundId, prefs.volume, 'plain');
      return;
    }
    void backend.load(soundId).then((ok) => {
      if (ok) backend.play(soundId, prefs.volume, 'plain');
    });
  }

  return {
    setPrefs(next: SoundPrefs): void {
      prefs = next;
      prefetch(next);
    },

    setMapId(next: string | null): void {
      if (next === mapId) return;
      mapId = next;
      standDown?.();
      standDown = null;
      if (election == null) {
        isLeader = true;
        return;
      }
      isLeader = false;
      if (next == null) return;
      standDown = election.claim(`${SOUND_LEADER_LOCK_PREFIX}${next}`, (leading) => {
        if (mapId !== next) return;
        isLeader = leading;
      });
    },

    play(event, opts): void {
      if (!prefs.enabled) return;
      if (!prefs.events[event].enabled) return;
      if (muted) return;
      if (!unlocked) return;
      if (!isLeader) return;
      const at = now();
      const last = lastPlayedAt.get(event);
      if (last != null && at - last < SOUND_COALESCE_MS) return;
      lastPlayedAt.set(event, at);
      backend.play(resolveSoundId(event), prefs.volume, opts?.variant ?? 'plain');
    },

    preview(soundId): void {
      if (unlocked) {
        playWhenLoaded(soundId);
        return;
      }
      // The preview click is itself the unlocking gesture, so play once granted.
      void backend.unlock().then((ok) => {
        applyUnlockResult(ok);
        if (ok) playWhenLoaded(soundId);
      });
    },

    unlock,

    setMuted(next: boolean): void {
      writeSoundMuted(next);
    },

    toggleMute(): void {
      writeSoundMuted(!muted);
    },

    getSnapshot: () => status,
    getServerSnapshot: () => SERVER_STATUS,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose(): void {
      standDown?.();
      standDown = null;
      for (const fn of teardown) fn();
      teardown.length = 0;
      listeners.clear();
    },
  };
}

/** Where the backend gets the bytes behind an imported `custom:` sound. */
export interface CustomSoundSource {
  bytesFor(soundId: SoundId): Promise<ArrayBuffer | null>;
  subscribe(listener: () => void): () => void;
}

/**
 * Web Audio playback: one `AudioContext`, one master gain, and one memoized
 * buffer per clip — a chime keyed by its sound id, a voice line by its file
 * path, an imported sound by its `custom:` id.
 */
export function createWebAudioBackend(
  deps: { customSounds?: CustomSoundSource } = {},
): SoundBackend {
  const customSounds = deps.customSounds ?? null;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  const buffers = new Map<string, AudioBuffer>();
  const failed = new Set<string>();
  const inflight = new Map<string, Promise<boolean>>();
  // Bumped whenever the device store changes, so a load that started before the
  // change cannot write its result into the cleared memo after it.
  let customGeneration = 0;

  // A sound the user deleted must stop answering `has`, and one they re-added
  // must not stay marked failed, so every `custom:` memo is dropped on a change.
  customSounds?.subscribe(() => {
    customGeneration += 1;
    for (const key of [...buffers.keys()]) if (key.startsWith('custom:')) buffers.delete(key);
    for (const key of [...failed]) if (key.startsWith('custom:')) failed.delete(key);
  });

  function ensure(): AudioContext | null {
    if (ctx) return ctx;
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
    try {
      ctx = new window.AudioContext();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function bufferFor(
    context: AudioContext,
    soundId: SoundId,
    variant: SoundVariant,
  ): AudioBuffer | null {
    const entry = getBuiltInSound(soundId);
    if (entry?.kind === 'voice') return buffers.get(entry.files[variant]) ?? null;
    const cached = buffers.get(soundId);
    if (cached) return cached;
    if (entry?.kind !== 'chime') return null;
    try {
      const buffer = entry.synth(context);
      buffers.set(soundId, buffer);
      return buffer;
    } catch {
      return null;
    }
  }

  /** Fetches and decodes one file, memoizing the buffer, the failure and the wait. */
  function loadFile(context: AudioContext, path: string): Promise<boolean> {
    if (buffers.has(path)) return Promise.resolve(true);
    // A path that already failed is never retried, so a cue-time retry cannot
    // turn a missing file into a fetch per cue.
    if (failed.has(path)) return Promise.resolve(false);
    const running = inflight.get(path);
    if (running) return running;
    const task = (async () => {
      try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`${response.status}`);
        buffers.set(path, await context.decodeAudioData(await response.arrayBuffer()));
        return true;
      } catch {
        failed.add(path);
        return false;
      } finally {
        inflight.delete(path);
      }
    })();
    inflight.set(path, task);
    return task;
  }

  /** Pulls an imported sound's bytes out of the device store and decodes them. */
  function loadCustom(soundId: SoundId): Promise<boolean> {
    if (buffers.has(soundId)) return Promise.resolve(true);
    if (!customSounds || failed.has(soundId)) return Promise.resolve(false);
    const running = inflight.get(soundId);
    if (running) return running;
    const context = ensure();
    if (!context) return Promise.resolve(false);
    const generation = customGeneration;
    const task = (async () => {
      try {
        const bytes = await customSounds.bytesFor(soundId);
        if (!bytes) throw new Error('not on this device');
        const buffer = await context.decodeAudioData(bytes);
        if (generation !== customGeneration) return false;
        buffers.set(soundId, buffer);
        return true;
      } catch {
        if (generation === customGeneration) failed.add(soundId);
        return false;
      } finally {
        inflight.delete(soundId);
      }
    })();
    inflight.set(soundId, task);
    return task;
  }

  return {
    isUnlocked: () => ctx?.state === 'running',

    async unlock(): Promise<boolean> {
      const context = ensure();
      if (!context) return false;
      try {
        if (context.state !== 'running') await context.resume();
      } catch {
        return false;
      }
      return context.state === 'running';
    },

    has(soundId): boolean {
      const entry = getBuiltInSound(soundId);
      if (entry?.kind === 'chime') return true;
      if (entry?.kind === 'voice') return soundFilesFor(soundId).every((f) => buffers.has(f));
      return buffers.has(soundId);
    },

    async load(soundId): Promise<boolean> {
      const entry = getBuiltInSound(soundId);
      if (entry?.kind === 'chime') return true;
      if (entry?.kind !== 'voice') return loadCustom(soundId);
      const context = ensure();
      if (!context) return false;
      const loaded = await Promise.all(
        soundFilesFor(soundId).map((path) => loadFile(context, path)),
      );
      return loaded.every(Boolean);
    },

    play(soundId, gain, variant): void {
      const context = ensure();
      if (!context || context.state !== 'running' || !master) return;
      const buffer = bufferFor(context, soundId, variant);
      if (!buffer) return;
      try {
        const source = context.createBufferSource();
        source.buffer = buffer;
        const node = context.createGain();
        node.gain.value = Math.min(1, Math.max(0, gain));
        source.connect(node);
        node.connect(master);
        source.start();
      } catch {
        // A browser that refuses to start a source is indistinguishable from
        // silence; the toolbar indicator is the only surface for that.
      }
    },
  };
}

/**
 * Leader election over the Web Locks API. The lock is held for the tab's
 * lifetime, so the next waiter takes over the moment the holder goes.
 * Returns `null` where Web Locks is unavailable.
 */
export function createWebLocksElection(): SoundLeaderElection | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null;
  return {
    claim(key, onChange) {
      let stoodDown = false;
      let releaseHeld: (() => void) | null = null;
      const controller = new AbortController();
      void navigator.locks
        .request(
          key,
          { signal: controller.signal },
          () =>
            new Promise<void>((resolve) => {
              if (stoodDown) {
                resolve();
                return;
              }
              releaseHeld = resolve;
              onChange(true);
            }),
        )
        .catch(() => {});
      return () => {
        if (stoodDown) return;
        stoodDown = true;
        controller.abort();
        releaseHeld?.();
        onChange(false);
      };
    },
  };
}

let singleton: SoundEngine | null = null;

/** The app-wide engine, created on first use with the real browser backends. */
export function getSoundEngine(): SoundEngine {
  singleton ??= createSoundEngine({
    backend: createWebAudioBackend({ customSounds: getCustomSoundStore() }),
    election: createWebLocksElection(),
  });
  return singleton;
}
