import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUND_PREFS } from '@/lib/sounds/prefs';
import { shouldShowExperimentalAlertToast } from '@/lib/sounds/alertToast';

describe('shouldShowExperimentalAlertToast', () => {
  const base = DEFAULT_SOUND_PREFS.events.rallySet;

  it('is false when event is off', () => {
    expect(shouldShowExperimentalAlertToast({ ...base, enabled: false, toast: true })).toBe(
      false,
    );
  });

  it('is false when toast is off', () => {
    expect(shouldShowExperimentalAlertToast({ ...base, enabled: true, toast: false })).toBe(
      false,
    );
  });

  it('is true when event and toast are on', () => {
    expect(shouldShowExperimentalAlertToast({ ...base, enabled: true, toast: true })).toBe(
      true,
    );
  });
});