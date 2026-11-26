/** Standing tone for experimental pilot badges (tracked presence defaults friendly). */
export type PilotStandingTone = 'friendly' | 'hostile' | 'mixed';

import type { SystemStatus } from '@/lib/map/enumLabels';

/** Map-access pilots on the chain are friendly until hostility is modelled. */
export function pilotCountStandingTone(pilotCount: number): PilotStandingTone {
  if (pilotCount <= 0) return 'friendly';
  return 'friendly';
}

/** Tone from the on-map system status where the pilot is located. */
export function pilotStandingFromSystemStatus(status: SystemStatus): PilotStandingTone {
  switch (status) {
    case 'hostile':
      return 'hostile';
    case 'friendly':
    case 'occupied':
      return 'friendly';
    case 'unknown':
    case 'empty':
    case 'unscanned':
      return 'mixed';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Opacity for a pilot row from how long ago `locationAt` was reported (fade stale rows). */
export function pilotLocationFadeOpacity(locationAt: string, nowMs: number): number {
  const ts = Date.parse(locationAt);
  if (Number.isNaN(ts)) return 1;
  const ageMs = nowMs - ts;
  if (ageMs <= 2 * 60_000) return 1;
  if (ageMs >= 30 * 60_000) return 0.45;
  return 1 - ((ageMs - 2 * 60_000) / (28 * 60_000)) * 0.55;
}

export function pilotBadgeToneClasses(tone: PilotStandingTone): string {
  switch (tone) {
    case 'friendly':
      return 'text-sky-300 ring-sky-500/50';
    case 'hostile':
      return 'text-red-400 ring-red-500/50';
    case 'mixed':
      return 'text-amber-300 ring-amber-500/50';
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
}

export function pilotNameToneClass(tone: PilotStandingTone): string {
  switch (tone) {
    case 'friendly':
      return 'text-sky-200';
    case 'hostile':
      return 'text-red-300';
    case 'mixed':
      return 'text-amber-200';
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
}
