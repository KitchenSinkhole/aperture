import { describe, expect, it, vi } from 'vitest';
import { resolveSoundPrefs } from '@/lib/sounds/prefs';
import {
  SOUND_PREFS_CHANNEL,
  announceSoundPrefs,
  subscribeSoundPrefs,
} from '@/lib/sounds/prefsSync';

/** Resolves once pending BroadcastChannel deliveries have had a turn. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('sound prefs sync', () => {
  it("delivers another tab's saved prefs", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSoundPrefs(listener);
    const otherTab = new BroadcastChannel(SOUND_PREFS_CHANNEL);
    const prefs = { ...resolveSoundPrefs(null), enabled: true };

    otherTab.postMessage(prefs);
    await flush();

    expect(listener).toHaveBeenCalledWith(prefs);
    otherTab.close();
    unsubscribe();
  });

  it('does not echo a tab its own announcement', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSoundPrefs(listener);

    announceSoundPrefs(resolveSoundPrefs(null));
    await flush();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
