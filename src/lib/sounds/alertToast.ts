import type { SoundEventPrefs } from './prefs';

/** In-app alert toast: opt-in on the row and the event switch on, ignoring master/system sound mutes. */
export function shouldShowExperimentalAlertToast(prefs: SoundEventPrefs): boolean {
  return prefs.enabled && prefs.toast === true;
}