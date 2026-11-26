'use client';

import { readExperimentalUiFromHtml, isExperimentalUiActive } from '@/lib/experimentalUi';
import type { MapSystemNode } from '@/types';

const EXIT_ORIGIN_KEY = 'aperture:experimental:route-exit-origin';
const INCLUDE_JUMPBRIDGE_KEY = 'aperture:experimental:route-include-jb';
const FIGHT_MAP_SYSTEM_KEY = 'aperture:experimental:fight-map-system';

export type ExperimentalExitOrigin = 'chain' | 'selected';

export const EXPERIMENTAL_INCLUDE_JUMPBRIDGE_DEFAULT = true;

const FIGHT_TAG = /fight/i;

function experimentalOnly<T>(read: () => T, fallback: T): T {
  if (!isExperimentalUiActive(readExperimentalUiFromHtml())) return fallback;
  return read();
}

export function readExperimentalExitOrigin(): ExperimentalExitOrigin {
  return experimentalOnly(() => {
    try {
      return localStorage.getItem(EXIT_ORIGIN_KEY) === 'selected' ? 'selected' : 'chain';
    } catch {
      return 'chain';
    }
  }, 'chain');
}

export function writeExperimentalExitOrigin(v: ExperimentalExitOrigin): void {
  try {
    localStorage.setItem(EXIT_ORIGIN_KEY, v);
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent('aperture:experimental-route-prefs'));
}

export function readExperimentalIncludeJumpBridge(): boolean {
  return experimentalOnly(() => {
    try {
      const raw = localStorage.getItem(INCLUDE_JUMPBRIDGE_KEY);
      if (raw === null) return EXPERIMENTAL_INCLUDE_JUMPBRIDGE_DEFAULT;
      return raw === '1';
    } catch {
      return EXPERIMENTAL_INCLUDE_JUMPBRIDGE_DEFAULT;
    }
  }, true);
}

export function writeExperimentalIncludeJumpBridge(on: boolean): void {
  try {
    localStorage.setItem(INCLUDE_JUMPBRIDGE_KEY, on ? '1' : '0');
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent('aperture:experimental-route-prefs'));
}

/** Persists the map-system id tagged as the fight destination (experimental). */
export function readExperimentalFightMapSystemId(): string | null {
  return experimentalOnly(() => {
    try {
      const raw = localStorage.getItem(FIGHT_MAP_SYSTEM_KEY);
      return raw && raw.length > 0 ? raw : null;
    } catch {
      return null;
    }
  }, null);
}

export function writeExperimentalFightMapSystemId(mapSystemId: string | null): void {
  try {
    if (mapSystemId) localStorage.setItem(FIGHT_MAP_SYSTEM_KEY, mapSystemId);
    else localStorage.removeItem(FIGHT_MAP_SYSTEM_KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent('aperture:experimental-route-prefs'));
}

export function subscribeExperimentalRoutePrefs(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener('aperture:experimental-route-prefs', handler);
  return () => window.removeEventListener('aperture:experimental-route-prefs', handler);
}

/** Systems whose tag or alias matches `/fight/i`. */
export function fightTaggedSystems(systems: readonly MapSystemNode[]): MapSystemNode[] {
  return systems.filter((s) => {
    const tag = s.tag?.trim() ?? '';
    const alias = s.alias?.trim() ?? '';
    return FIGHT_TAG.test(tag) || FIGHT_TAG.test(alias);
  });
}

export type HomeFightRouteEnds = {
  home: MapSystemNode | null;
  fight: MapSystemNode | null;
};

/**
 * Resolves Home (`homeMapSystemId`) and fight (persisted id, else first fight-tagged
 * system) for one-click route shortcuts.
 */
export function resolveHomeFightRouteEnds(
  systems: readonly MapSystemNode[],
  homeMapSystemId: string | null,
): HomeFightRouteEnds {
  const home = homeMapSystemId
    ? (systems.find((s) => s.id === homeMapSystemId) ?? null)
    : null;
  const savedFight = readExperimentalFightMapSystemId();
  const fight =
    (savedFight ? systems.find((s) => s.id === savedFight) : null) ??
    fightTaggedSystems(systems)[0] ??
    null;
  return { home, fight };
}
