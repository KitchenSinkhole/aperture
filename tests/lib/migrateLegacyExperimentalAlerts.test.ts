import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_SOUND_PREFS } from '@/lib/sounds/prefs';
import { migrateLegacyExperimentalAlerts } from '@/lib/sounds/migrateLegacyExperimentalAlerts';

describe('migrateLegacyExperimentalAlerts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is unchanged when no legacy keys exist', () => {
    expect(migrateLegacyExperimentalAlerts(DEFAULT_SOUND_PREFS)).toEqual(DEFAULT_SOUND_PREFS);
  });

  it('maps rally toast legacy key to rallySet.toast and clears keys', () => {
    localStorage.setItem('aperture:experimental:alert-rally-toast', '1');
    const next = migrateLegacyExperimentalAlerts(DEFAULT_SOUND_PREFS);
    expect(next.events.rallySet.enabled).toBe(false);
    expect(next.events.rallySet.toast).toBe(true);
    expect(localStorage.getItem('aperture:experimental:alert-rally-toast')).toBeNull();
  });

  it('maps route hazard to activeRouteLinkAlert', () => {
    localStorage.setItem('aperture:experimental:alert-route-hazard-toast', '1');
    const next = migrateLegacyExperimentalAlerts(DEFAULT_SOUND_PREFS);
    expect(next.events.activeRouteLinkAlert.enabled).toBe(true);
  });
});