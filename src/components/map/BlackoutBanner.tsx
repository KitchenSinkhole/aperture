'use client';

import { EyeOff } from 'lucide-react';
import type { BlackoutStatus } from '@/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formatted in UTC (EVE time) from the timestamp alone, so the server render and
// the hydrated client agree.
function formatSince(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} EVE`;
}

/**
 * Persistent strip at the top of the map view while Blackout is on. Shown to
 * every viewer, with copy that depends on whether this viewer is cleared to see
 * pilots. Has no dismiss control and names no individual.
 */
export function BlackoutBanner({ blackout }: { blackout: BlackoutStatus }) {
  if (!blackout.active) return null;

  const detail = blackout.cleared
    ? "Members can't see pilot locations. You can."
    : 'Pilot locations are hidden. You can still see your own characters.';
  const since = blackout.since ? formatSince(blackout.since) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-blackout={blackout.cleared ? 'cleared' : 'restricted'}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-foreground px-3 py-2 text-sm text-background"
    >
      <EyeOff className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Blackout in effect.</span> {detail}
      </p>
      {since ? (
        <span className="shrink-0 text-xs tabular-nums opacity-70">Since {since}</span>
      ) : null}
    </div>
  );
}
