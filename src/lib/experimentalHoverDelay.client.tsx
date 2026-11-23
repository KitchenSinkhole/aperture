'use client';

import { Tooltip } from '@base-ui/react/tooltip';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isExperimentalUiActive, readExperimentalUiFromHtml } from '@/lib/experimentalUi';
import {
  DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS,
  readExperimentalHoverDelayMs,
  writeExperimentalHoverDelayMs,
} from '@/lib/experimentalHoverDelay';

type HoverDelayContextValue = {
  delayMs: number;
  setDelayMs: (ms: number) => void;
  experimentalActive: boolean;
};

const HoverDelayContext = createContext<HoverDelayContextValue | null>(null);

export function ExperimentalHoverDelayProvider({ children }: { children: ReactNode }) {
  const [experimentalActive, setExperimentalActive] = useState(() =>
    isExperimentalUiActive(readExperimentalUiFromHtml()),
  );
  const [delayMs, setDelayMsState] = useState(() => readExperimentalHoverDelayMs());

  useEffect(() => {
    const syncMode = () => setExperimentalActive(isExperimentalUiActive(readExperimentalUiFromHtml()));
    const syncDelay = () => setDelayMsState(readExperimentalHoverDelayMs());
    syncMode();
    syncDelay();
    const obs = new MutationObserver(syncMode);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui', 'data-theme'] });
    window.addEventListener('aperture:experimental-hover-delay', syncDelay);
    window.addEventListener('storage', syncDelay);
    return () => {
      obs.disconnect();
      window.removeEventListener('aperture:experimental-hover-delay', syncDelay);
      window.removeEventListener('storage', syncDelay);
    };
  }, []);

  const setDelayMs = useCallback((ms: number) => {
    writeExperimentalHoverDelayMs(ms);
    setDelayMsState(readExperimentalHoverDelayMs());
  }, []);

  const value = useMemo(
    () => ({ delayMs, setDelayMs, experimentalActive }),
    [delayMs, setDelayMs, experimentalActive],
  );

  if (!experimentalActive) {
    return <HoverDelayContext.Provider value={value}>{children}</HoverDelayContext.Provider>;
  }

  return (
    <HoverDelayContext.Provider value={value}>
      <Tooltip.Provider delay={delayMs} closeDelay={delayMs}>
        {children}
      </Tooltip.Provider>
    </HoverDelayContext.Provider>
  );
}

export function useExperimentalHoverDelayContext(): HoverDelayContextValue {
  const ctx = useContext(HoverDelayContext);
  if (!ctx) {
    return {
      delayMs: DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS,
      setDelayMs: writeExperimentalHoverDelayMs,
      experimentalActive: false,
    };
  }
  return ctx;
}

/** Preview-card / popover hover triggers — undefined when legacy UI is active. */
export function useExperimentalHoverTriggerDelays():
  | { delay: number; closeDelay: number }
  | undefined {
  const { delayMs, experimentalActive } = useExperimentalHoverDelayContext();
  if (!experimentalActive) return undefined;
  return { delay: delayMs, closeDelay: delayMs };
}
