'use client';

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { readExperimentalCombatRingMs } from '@/lib/experimentalCombatRingDuration';

type Store = {
  /** mapSystemId → expiry timestamp (ms) */
  rings: Map<string, number>;
  listeners: Set<() => void>;
};

function createStore(): Store {
  return { rings: new Map(), listeners: new Set() };
}

const CombatRingContext = createContext<Store | null>(null);

export function ExperimentalCombatRingProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createStore(), []);
  return <CombatRingContext.Provider value={store}>{children}</CombatRingContext.Provider>;
}

function subscribe(store: Store, onChange: () => void): () => void {
  store.listeners.add(onChange);
  return () => store.listeners.delete(onChange);
}

export function useExperimentalCombatRingActive(mapSystemId: string): boolean {
  const store = useContext(CombatRingContext);
  return useSyncExternalStore(
    (onChange) => (store ? subscribe(store, onChange) : () => {}),
    () => {
      if (!store) return false;
      const exp = store.rings.get(mapSystemId);
      return exp !== undefined && exp > Date.now();
    },
    () => false,
  );
}

export function useExperimentalCombatRingActions(): { markKill: (mapSystemId: string) => void } {
  const store = useContext(CombatRingContext);
  return useMemo(
    () => ({
      markKill: (mapSystemId: string) => {
        if (!store) return;
        const durationMs = readExperimentalCombatRingMs();
        if (durationMs <= 0) return;
        store.rings.set(mapSystemId, Date.now() + durationMs);
        for (const l of store.listeners) l();
      },
    }),
    [store],
  );
}
