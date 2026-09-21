'use client';

import { getBuiltInSound } from './catalog';
import { readSoundMuted, subscribeSoundMuted, writeSoundMuted } from './mutePrefs';
import {
  DEFAULT_SOUND_PREFS,
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
  /** Whether a buffer for this id can be produced on this device. */
  has(soundId: SoundId): boolean;
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
    return backend.has(wanted) ? wanted : DEFAULT_SOUND_PREFS.events[event].sound;
  }

  return {
    setPrefs(next: SoundPrefs): void {
      prefs = next;
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
      if (!backend.has(soundId)) return;
      if (unlocked) {
        backend.play(soundId, prefs.volume, 'plain');
        return;
      }
      // The preview click is itself the unlocking gesture, so play once granted.
      void backend.unlock().then((ok) => {
        applyUnlockResult(ok);
        if (ok) backend.play(soundId, prefs.volume, 'plain');
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

/** Web Audio playback: one `AudioContext`, one master gain, buffers memoized per id. */
export function createWebAudioBackend(): SoundBackend {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  const buffers = new Map<SoundId, AudioBuffer>();

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

  function bufferFor(context: AudioContext, soundId: SoundId): AudioBuffer | null {
    const cached = buffers.get(soundId);
    if (cached) return cached;
    const entry = getBuiltInSound(soundId);
    if (!entry) return null;
    try {
      const buffer = entry.synth(context);
      buffers.set(soundId, buffer);
      return buffer;
    } catch {
      return null;
    }
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

    has: (soundId) => buffers.has(soundId) || getBuiltInSound(soundId) != null,

    play(soundId, gain): void {
      const context = ensure();
      if (!context || context.state !== 'running' || !master) return;
      const buffer = bufferFor(context, soundId);
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
    backend: createWebAudioBackend(),
    election: createWebLocksElection(),
  });
  return singleton;
}
