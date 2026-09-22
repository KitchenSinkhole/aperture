'use client';

import type { SoundPrefs } from './prefs';

/** BroadcastChannel name that carries a saved `SoundPrefs` to the device's other tabs. */
export const SOUND_PREFS_CHANNEL = 'aperture:sound-prefs';

const listeners = new Set<(prefs: SoundPrefs) => void>();
// One channel per tab for both directions: a BroadcastChannel never delivers to
// the object that posted, so the tab never hears its own announcement.
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(SOUND_PREFS_CHANNEL);
  channel.onmessage = (event: MessageEvent<SoundPrefs>) => {
    for (const listener of listeners) listener(event.data);
  };
  return channel;
}

/** Tell the device's other tabs the account's sound prefs were saved. */
export function announceSoundPrefs(prefs: SoundPrefs): void {
  getChannel()?.postMessage(prefs);
}

/** Receive prefs another tab on this device saved; returns an unsubscribe fn. */
export function subscribeSoundPrefs(listener: (prefs: SoundPrefs) => void): () => void {
  getChannel();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
