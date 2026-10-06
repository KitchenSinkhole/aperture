'use client';

/**
 * Device-level sound mute, persisted to localStorage so it survives a reload
 * and applies to every tab on the device. Exposed as a subscribable store so
 * the toolbar button and the engine stay in step.
 */

export const SOUND_MUTED_KEY = 'aperture:sounds:muted';

let cache: boolean | null = null;
const listeners = new Set<() => void>();
let detachStorage: (() => void) | null = null;

function compute(): boolean {
  try {
    return localStorage.getItem(SOUND_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Re-read storage and notify only on an actual change. */
function refresh(): void {
  const next = compute();
  if (next === cache) return;
  cache = next;
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  // A `null` key is a whole-storage clear, which also drops the mute flag.
  if (event.key !== null && event.key !== SOUND_MUTED_KEY) return;
  refresh();
}

/** Whether sounds are muted on this device. Cached between calls. */
export function readSoundMuted(): boolean {
  if (cache == null) cache = compute();
  return cache;
}

/** Server snapshot for `useSyncExternalStore` — never muted. */
export function getServerSoundMuted(): boolean {
  return false;
}

/** Persist the mute flag and notify subscribers. */
export function writeSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(SOUND_MUTED_KEY, muted ? '1' : '0');
  } catch {}
  cache = muted;
  for (const listener of listeners) listener();
}

/**
 * Subscribe to mute changes; returns an unsubscribe fn. While at least one
 * listener is registered the store tracks the `storage` event, so a mute
 * written in another tab reaches this one without a reload.
 */
export function subscribeSoundMuted(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    detachStorage = () => window.removeEventListener('storage', onStorage);
    // Another tab may have written while nothing here was listening.
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    detachStorage?.();
    detachStorage = null;
  };
}
