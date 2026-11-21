'use client';

import { toast } from 'sonner';
import { setSoundPrefsAction } from '@/app/(app)/actions/account';
import { getSoundEngine } from './engine';
import { announceSoundPrefs } from './prefsSync';
import type { SoundPrefs } from './prefs';

let pending = 0;
let confirmed: SoundPrefs | null = null;

/**
 * Apply `next` to the engine straight away, persist it to the account, and on
 * success tell the device's other tabs. On failure the engine goes back to the
 * last copy the server accepted and the error is toasted, unless a newer edit
 * has replaced `next` meanwhile, which the rollback must not undo.
 *
 * The rollback target is the last accepted copy rather than `prev` because
 * saves can overlap (the map menu doesn't lock while one is in flight), and
 * then `prev` is itself an optimistic edit that may never land.
 *
 * @returns Whether the save landed.
 */
export async function saveSoundPrefs(next: SoundPrefs, prev: SoundPrefs): Promise<boolean> {
  const engine = getSoundEngine();
  if (pending === 0) confirmed = prev;
  pending++;
  engine.setPrefs(next);
  try {
    const result = await setSoundPrefsAction(next);
    if (result.ok) {
      confirmed = next;
      announceSoundPrefs(next);
      return true;
    }
    if (engine.getPrefs() === next) engine.setPrefs(confirmed ?? prev);
    toast.error(result.error);
    return false;
  } finally {
    pending--;
  }
}
