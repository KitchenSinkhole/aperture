'use client';

import type { SoundPrefs } from './prefs';

const LEGACY_KEYS = [
  'aperture:experimental:alert-rally-toast',
  'aperture:experimental:alert-rally-desktop',
  'aperture:experimental:alert-route-offroute-toast',
  'aperture:experimental:alert-route-hazard-toast',
] as const;

/**
 * One-time lift from device-local experimental alert prefs into `SoundPrefs`.
 * Clears legacy keys after applying. Safe to call on every settings open.
 */
export function migrateLegacyExperimentalAlerts(prefs: SoundPrefs): SoundPrefs {
  if (typeof localStorage === 'undefined') return prefs;
  let rallyToast = false;
  let rallyDesktop = false;
  let routeOffRoute = false;
  let routeHazard = false;
  let touched = false;
  for (const key of LEGACY_KEYS) {
    if (localStorage.getItem(key) !== '1') continue;
    touched = true;
    switch (key) {
      case 'aperture:experimental:alert-rally-toast':
        rallyToast = true;
        break;
      case 'aperture:experimental:alert-rally-desktop':
        rallyDesktop = true;
        break;
      case 'aperture:experimental:alert-route-offroute-toast':
        routeOffRoute = true;
        break;
      case 'aperture:experimental:alert-route-hazard-toast':
        routeHazard = true;
        break;
      default: {
        const _exhaustive: never = key;
        return _exhaustive;
      }
    }
    localStorage.removeItem(key);
  }
  if (!touched) return prefs;

  const events = { ...prefs.events };
  if (rallyToast || rallyDesktop) {
    events.rallySet = {
      ...events.rallySet,
      toast: events.rallySet.toast === true || rallyToast,
      desktopNotification: events.rallySet.desktopNotification === true || rallyDesktop,
    };
  }
  if (routeOffRoute) {
    events.activeRouteOffRoute = { ...events.activeRouteOffRoute, enabled: true };
  }
  if (routeHazard) {
    events.activeRouteLinkAlert = { ...events.activeRouteLinkAlert, enabled: true };
  }
  return { ...prefs, events };
}