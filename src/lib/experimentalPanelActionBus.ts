import type { PanelId } from '@/types';

type Listener = () => void;

const listeners = new Map<PanelId, Set<Listener>>();

/** Request the panel's primary "Add" action (header button or command palette). */
export function requestExperimentalPanelAdd(panelId: PanelId): void {
  for (const cb of listeners.get(panelId) ?? []) cb();
}

export function subscribeExperimentalPanelAdd(panelId: PanelId, listener: Listener): () => void {
  let set = listeners.get(panelId);
  if (!set) {
    set = new Set();
    listeners.set(panelId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(panelId);
  };
}
