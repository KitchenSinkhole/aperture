'use client';

import { useEffect } from 'react';
import { applyPointerCursorAttribute, readExperimentalPointerCursor } from '@/lib/experimentalQolPrefs';

/** Applies experimental QoL DOM attributes on mount and when prefs change. */
export function ExperimentalQolController() {
  useEffect(() => {
    const sync = () => applyPointerCursorAttribute(readExperimentalPointerCursor());
    sync();
    window.addEventListener('aperture:experimental-qol-prefs', sync);
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui', 'data-variant'] });
    return () => {
      window.removeEventListener('aperture:experimental-qol-prefs', sync);
      obs.disconnect();
    };
  }, []);
  return null;
}
