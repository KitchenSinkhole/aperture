'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { RoutePlan } from '@/types';

export type ExperimentalRouteHighlight = {
  connectionIds: ReadonlySet<string>;
  mapSystemIds: ReadonlySet<string>;
};

const empty: ExperimentalRouteHighlight = {
  connectionIds: new Set(),
  mapSystemIds: new Set(),
};

const Ctx = createContext<{
  highlight: ExperimentalRouteHighlight;
  setFromPlan: (plan: RoutePlan | null) => void;
} | null>(null);

export function ExperimentalRouteHighlightProvider({ children }: { children: ReactNode }) {
  const [highlight, setHighlight] = useState<ExperimentalRouteHighlight>(empty);
  const setFromPlan = useCallback((plan: RoutePlan | null) => {
    if (!plan?.reachable) {
      setHighlight(empty);
      return;
    }
    const connectionIds = new Set<string>();
    const mapSystemIds = new Set<string>();
    for (const hop of plan.hops) {
      if (hop.onMap) mapSystemIds.add(String(hop.systemId));
      if (hop.connectionId != null) connectionIds.add(String(hop.connectionId));
    }
    setHighlight({ connectionIds, mapSystemIds });
  }, []);
  const value = useMemo(() => ({ highlight, setFromPlan }), [highlight, setFromPlan]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExperimentalRouteHighlight(): ExperimentalRouteHighlight {
  return useContext(Ctx)?.highlight ?? empty;
}

export function useExperimentalRouteHighlightActions() {
  const ctx = useContext(Ctx);
  return ctx?.setFromPlan ?? (() => {});
}
