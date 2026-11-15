'use client';

import { toast } from 'sonner';
import { setSoundPrefsAction } from '@/app/(app)/actions/account';
import { getSoundEngine } from './engine';
import { announceSoundPrefs } from './prefsSync';
import type { SoundPrefs } from './prefs';

/**
 * Apply `next` to the engine straight away, persist it to the account, and on
 * success tell the device's other tabs. On failure the engine goes back to
 * `prev` and the error is toasted, unless a newer edit has replaced `next`
 * meanwhile, which the rollback must not undo.
 *
 * @returns Whether the save landed.
 */
export async function saveSoundPrefs(next: SoundPrefs, prev: SoundPrefs): Promise<boolean> {
  const engine = getSoundEngine();
  engine.setPrefs(next);
  const result = await setSoundPrefsAction(next);
  if (result.ok) {
    announceSoundPrefs(next);
    return true;
  }
  if (engine.getPrefs() === next) engine.setPrefs(prev);
  toast.error(result.error);
  return false;
}
